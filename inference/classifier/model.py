"""Frozen / LoRA DINOv2 CLS probe for whole-image AI detection."""
from __future__ import annotations

from typing import Tuple

import torch
import torch.nn as nn
from transformers import Dinov2Model

_LORA_TARGETS = ("q_proj", "k_proj", "v_proj", "o_proj")


class DinoProbeClassifier(nn.Module):
    def __init__(
        self,
        backbone: str = "facebook/dinov2-small",
        freeze_backbone: bool = True,
        lora_r: int = 0,
        lora_alpha: int = 16,
        lora_dropout: float = 0.05,
    ):
        super().__init__()
        self.lora_r = int(lora_r)
        self.backbone = Dinov2Model.from_pretrained(backbone)
        self.hidden = self.backbone.config.hidden_size
        self.head = nn.Linear(self.hidden, 1)

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

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        out = self.backbone(pixel_values=pixel_values)
        cls = out.last_hidden_state[:, 0, :]
        return self.head(cls).squeeze(-1)

    def trainable_parameters(self):
        return [p for p in self.parameters() if p.requires_grad]

    def export_trainable_state(self) -> dict:
        payload = {"head": self.head.state_dict(), "lora_r": self.lora_r}
        if self.lora_r > 0:
            payload["lora"] = {
                k: v.detach().cpu()
                for k, v in self.backbone.state_dict().items()
                if "lora_" in k
            }
        return payload


def load_classifier(checkpoint: str, device: str, backbone: str = "facebook/dinov2-small") -> Tuple[DinoProbeClassifier, dict]:
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    cfg = ckpt.get("config", {})
    lora_r = int(cfg.get("lora_r", 0) or 0)
    model = DinoProbeClassifier(
        backbone=cfg.get("backbone", backbone),
        freeze_backbone=True,
        lora_r=lora_r,
        lora_alpha=int(cfg.get("lora_alpha", 16)),
    )
    model.head.load_state_dict(ckpt["head"])
    if lora_r > 0 and "lora" in ckpt:
        missing = model.backbone.load_state_dict(ckpt["lora"], strict=False)
        miss = [k for k in missing.missing_keys if "lora_" in k]
        if miss:
            raise RuntimeError(f"LoRA checkpoint missing keys: {miss[:8]}")
    model.to(device).eval()
    return model, cfg
