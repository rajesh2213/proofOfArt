"""P3 DinoLizer-style localizer adapter for the eval harness."""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Set

import numpy as np
from PIL import Image

from eval.adapters.base import DecisionConfig, LocalizerAdapter, ModelInfo, file_sha256
from eval.config import INFERENCE_ROOT

DEFAULT_CKPT = INFERENCE_ROOT / "core/models/ai_edit_localization/best_dinolizer.pt"


class DinoLizerAdapter(LocalizerAdapter):
    batch_size = 1
    # From localizer.calibrate_decision on LoRA v2 (subset): prefer lower hallu.
    decision = DecisionConfig(
        mask_threshold=0.45,
        min_edited_area_ratio=0.01,
        min_mask_pixels=200,
        morph_closing=3,
    )

    def __init__(self, checkpoint: Optional[Path] = None, device: Optional[str] = None):
        import torch
        from localizer.infer import predict_prob_map
        from localizer.model import load_localizer

        self.checkpoint = Path(checkpoint or DEFAULT_CKPT)
        if not self.checkpoint.exists():
            raise FileNotFoundError(
                f"DinoLizer checkpoint not found: {self.checkpoint}. "
                "Train with: python -m localizer.train"
            )
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model, self.cfg = load_localizer(str(self.checkpoint), self.device)
        self._predict_prob_map = predict_prob_map
        self.window = int(self.cfg.get("image_size", 518))
        self.stride = max(self.window // 2, 1)
        self.sha = file_sha256(self.checkpoint)

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="dinolizer_v1",
            architecture=f"Frozen {self.cfg.get('backbone', 'dinov2')} + linear patch head",
            checkpoint=self.checkpoint.resolve().relative_to(INFERENCE_ROOT).as_posix(),
            checkpoint_sha256=self.sha,
            input_size=self.window,
            notes=[
                "Sliding-window inference at native resolution.",
                "Trained on unified_v1 ai_local_edit + traditional_edit + pristine_real.",
            ],
        )

    def predict_prob_maps(self, images: List[Image.Image]) -> List[np.ndarray]:
        return [
            self._predict_prob_map(self.model, img, self.device, self.window, self.stride)
            for img in images
        ]

    def seen_paths(self) -> Optional[Set[str]]:
        # Training used the frozen unified train split; report those paths so
        # eval can exclude them when scoring the test set.
        import pandas as pd
        from localizer.config import UNIFIED_MANIFEST

        df = pd.read_csv(UNIFIED_MANIFEST, keep_default_na=False)
        df = df[(df["split"] == "train") & (df["label"].isin(
            ["ai_local_edit", "traditional_edit", "pristine_real"]
        ))]
        return set(df["path"].tolist())
