"""P2 DINOv2 CLS probe classifier adapter."""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Set

import numpy as np
from PIL import Image

from eval.adapters.base import ClassifierAdapter, DecisionConfig, ModelInfo, file_sha256
from eval.config import INFERENCE_ROOT

DEFAULT_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_dinoprobe.pt"


class DinoProbeAdapter(ClassifierAdapter):
    batch_size = 8
    decision = DecisionConfig(ai_threshold=0.6)

    def __init__(self, checkpoint: Optional[Path] = None, device: Optional[str] = None):
        import torch
        from classifier.dataset import imagenet_normalize
        from classifier.model import load_classifier

        self.checkpoint = Path(checkpoint or DEFAULT_CKPT)
        if not self.checkpoint.exists():
            raise FileNotFoundError(
                f"DinoProbe checkpoint not found: {self.checkpoint}. "
                "Train with: python -m classifier.train"
            )
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model, self.cfg = load_classifier(str(self.checkpoint), self.device)
        self.image_size = int(self.cfg.get("image_size", 224))
        self._normalize = imagenet_normalize
        self._torch = torch
        self.sha = file_sha256(self.checkpoint)

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="dinoprobe_v1",
            architecture=f"Frozen {self.cfg.get('backbone', 'dinov2')} CLS + linear (LoRA r={self.cfg.get('lora_r', 0)})",
            checkpoint=self.checkpoint.resolve().relative_to(INFERENCE_ROOT).as_posix(),
            checkpoint_sha256=self.sha,
            input_size=self.image_size,
            notes=["Q1 whole-image probe on pristine_real vs fully_synthetic from unified_v1."],
        )

    def predict_proba(self, images: List[Image.Image]) -> np.ndarray:
        torch = self._torch
        tensors = []
        for img in images:
            rgb = img.convert("RGB").resize((self.image_size, self.image_size), Image.BILINEAR)
            chw = torch.from_numpy(np.asarray(rgb).astype(np.float32) / 255.0).permute(2, 0, 1)
            tensors.append(self._normalize(chw))
        batch = torch.stack(tensors).to(self.device)
        with torch.no_grad():
            logits = self.model(batch)
            probs = torch.sigmoid(logits).detach().cpu().numpy().reshape(-1)
        return probs.astype(np.float64)

    def seen_paths(self) -> Optional[Set[str]]:
        return None
