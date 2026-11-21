"""Frozen / LoRA DINOv2 patch localizer, with optional residual dual-stream head."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import torch
import torch.nn as nn
from transformers import Dinov2Model

from localizer.residual import highpass_residual

_LORA_TARGETS = ("q_proj", "k_proj", "v_proj", "o_proj")


@dataclass
class LocalizerOutput:
    logits: torch.Tensor  # (B, H, W) patch logits
    probs: torch.Tensor  # (B, H, W) sigmoid


class ResidualPatchEncoder(nn.Module):
    """Tiny CNN → patch-grid features matching DINOv2 token grid."""

    def __init__(self, out_dim: int, patch: int = 14):
        super().__init__()
        self.patch = patch
        self.net = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1),
            nn.GELU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1),
            nn.GELU(),
            nn.Conv2d(64, out_dim, 3, stride=2, padding=1),
            nn.GELU(),
        )

    def forward(self, residual: torch.Tensor, side: int) -> torch.Tensor:
        # residual: (B,3,H,W) → (B, side, side, C)
        feat = self.net(residual)
        feat = nn.functional.adaptive_avg_pool2d(feat, (side, side))
        return feat.permute(0, 2, 3, 1).reshape(residual.shape[0], side * side, -1)


class DinoPatchLocalizer(nn.Module):
    def __init__(
        self,
        backbone: str = "facebook/dinov2-small",
        freeze_backbone: bool = True,
        lora_r: int = 0,
        lora_alpha: int = 16,
        lora_dropout: float = 0.05,
        dual_stream: bool = False,
        residual_dim: int = 64,
    ):
        super().__init__()
        self.backbone_name = backbone
        self.lora_r = int(lora_r)
        self.dual_stream = bool(dual_stream)
        self.backbone = Dinov2Model.from_pretrained(backbone)
        self.hidden = self.backbone.config.hidden_size
        self.patch = self.backbone.config.patch_size
        self.residual_enc = ResidualPatchEncoder(residual_dim, self.patch) if self.dual_stream else None
        head_in = self.hidden + (residual_dim if self.dual_stream else 0)
        self.head = nn.Linear(head_in, 1)

        if self.lora_r > 0:
            from peft import LoraConfig, get_peft_model

            for p in self.backbone.parameters():
                p.requires_grad = False
            self.backbone = get_peft_model(
                self.backbone,
                LoraConfig(
                    r=self.lora_r,
                    lora_alpha=lora_alpha,
                    lora_dropout=lora_dropout,
                    bias="none",
                    target_modules=list(_LORA_TARGETS),
                ),
            )
        elif freeze_backbone:
            for p in self.backbone.parameters():
                p.requires_grad = False
            self.backbone.eval()

    def train(self, mode: bool = True):
        super().train(mode)
        if self.lora_r <= 0:
            self.backbone.eval()
        return self

    def forward(self, pixel_values: torch.Tensor, residual: Optional[torch.Tensor] = None) -> LocalizerOutput:
        out = self.backbone(pixel_values=pixel_values)
        tokens = out.last_hidden_state[:, 1:, :]  # drop CLS
        b, n, c = tokens.shape
        side = int(n**0.5)
        if side * side != n:
            raise ValueError(f"Non-square patch grid: {n} tokens")
        if self.dual_stream:
            if residual is None:
                residual = highpass_residual(pixel_values)
            r_tok = self.residual_enc(residual, side)
            tokens = torch.cat([tokens, r_tok], dim=-1)
        logits = self.head(tokens).squeeze(-1).view(b, side, side)
        return LocalizerOutput(logits=logits, probs=torch.sigmoid(logits))

    def trainable_parameters(self):
        return [p for p in self.parameters() if p.requires_grad]

    def export_trainable_state(self) -> dict:
        payload = {
            "head": self.head.state_dict(),
            "train_backbone": False,
            "lora_r": self.lora_r,
            "dual_stream": self.dual_stream,
        }
        if self.dual_stream and self.residual_enc is not None:
            payload["residual_enc"] = self.residual_enc.state_dict()
        if self.lora_r > 0:
            payload["lora"] = {
                k: v.detach().cpu()
                for k, v in self.backbone.state_dict().items()
                if "lora_" in k
            }
        return payload


def load_localizer(
    checkpoint: str,
    device: str,
    backbone: str = "facebook/dinov2-small",
) -> Tuple[DinoPatchLocalizer, dict]:
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    cfg = ckpt.get("config", {})
    lora_r = int(cfg.get("lora_r", 0) or 0)
    dual = bool(cfg.get("dual_stream", ckpt.get("dual_stream", False)))
    model = DinoPatchLocalizer(
        backbone=cfg.get("backbone", backbone),
        freeze_backbone=True,
        lora_r=lora_r,
        lora_alpha=int(cfg.get("lora_alpha", 16)),
        dual_stream=dual,
        residual_dim=int(cfg.get("residual_dim", 64)),
    )
    model.head.load_state_dict(ckpt["head"])
    if dual and "residual_enc" in ckpt:
        model.residual_enc.load_state_dict(ckpt["residual_enc"])
    if lora_r > 0 and "lora" in ckpt:
        missing = model.backbone.load_state_dict(ckpt["lora"], strict=False)
        miss = [k for k in missing.missing_keys if "lora_" in k]
        if miss:
            raise RuntimeError(f"LoRA checkpoint missing keys: {miss[:8]}")
    elif "backbone" in ckpt and ckpt.get("train_backbone"):
        model.backbone.load_state_dict(ckpt["backbone"])
    model.to(device).eval()
    return model, cfg
