"""Localization samples from unified_v1.csv."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import Dataset

from localizer.config import INFERENCE_ROOT, PATCH_POS_FRAC, UNIFIED_MANIFEST

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def imagenet_normalize(chw: torch.Tensor) -> torch.Tensor:
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
    return (chw - mean) / std


def mask_to_patch_labels(mask: np.ndarray, image_size: int, patch: int, pos_frac: float) -> torch.Tensor:
    """Average-pool a HxW binary mask into a grid of patch labels."""
    side = image_size // patch
    t = torch.from_numpy(mask.astype(np.float32))[None, None]
    pooled = torch.nn.functional.adaptive_avg_pool2d(t, (side, side)).squeeze()
    return (pooled >= pos_frac).float()


def load_rows(
    split: str,
    labels: Optional[List[str]] = None,
    max_per_label: Optional[int] = None,
    keep_all_ai: bool = True,
    seed: int = 0,
) -> pd.DataFrame:
    df = pd.read_csv(UNIFIED_MANIFEST, keep_default_na=False)
    df = df[df["split"] == split]
    # Localization cares about local edits and pristine negatives. Fully synthetic
    # images have no local mask and would teach the wrong signal.
    if labels is None:
        labels = ["ai_local_edit", "traditional_edit", "pristine_real"]
    df = df[df["label"].isin(labels)].copy()
    if max_per_label is None and not keep_all_ai:
        return df.reset_index(drop=True)

    # Default balance: keep every AI edit, cap traditional/pristine so the loader
    # is not 80% empty negatives.
    caps = {
        "ai_local_edit": None if keep_all_ai else max_per_label,
        "traditional_edit": max_per_label if max_per_label is not None else 2000,
        "pristine_real": max_per_label if max_per_label is not None else 2000,
    }
    parts = []
    rng = np.random.default_rng(seed)
    for lab, g in df.groupby("label"):
        cap = caps.get(lab, max_per_label)
        if cap is None or len(g) <= cap:
            parts.append(g)
        else:
            idx = rng.choice(len(g), size=cap, replace=False)
            parts.append(g.iloc[idx])
    return pd.concat(parts, ignore_index=True).sample(frac=1, random_state=seed).reset_index(drop=True)


class EditLocalizationDataset(Dataset):
    def __init__(self, rows: pd.DataFrame, image_size: int, patch: int = 14,
                 train: bool = False, jpeg_prob: float = 0.0, pos_frac: float = PATCH_POS_FRAC):
        self.rows = rows
        self.image_size = image_size
        self.patch = patch
        self.train = train
        self.jpeg_prob = jpeg_prob
        self.pos_frac = pos_frac
        self.rng = np.random.default_rng(0)

    def __len__(self) -> int:
        return len(self.rows)

    def _maybe_jpeg(self, img: Image.Image) -> Image.Image:
        if not self.train or self.rng.random() > self.jpeg_prob:
            return img
        q = int(self.rng.integers(50, 95))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q)
        buf.seek(0)
        return Image.open(buf).convert("RGB")

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        row = self.rows.iloc[idx]
        img = Image.open(INFERENCE_ROOT / row.path).convert("RGB")
        if row.mask_path:
            mask = np.asarray(Image.open(INFERENCE_ROOT / row.mask_path).convert("L")) > 127
        else:
            mask = np.zeros((img.height, img.width), dtype=bool)

        if self.train and self.rng.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
            mask = np.fliplr(mask)

        img = self._maybe_jpeg(img)
        img = img.resize((self.image_size, self.image_size), Image.BICUBIC)
        mask = np.asarray(
            Image.fromarray(mask.astype(np.uint8) * 255).resize(
                (self.image_size, self.image_size), Image.NEAREST
            )
        ) > 127

        chw01 = torch.from_numpy(np.asarray(img).astype(np.float32) / 255.0).permute(2, 0, 1)
        from localizer.residual import highpass_residual

        residual = highpass_residual(chw01)
        chw = imagenet_normalize(chw01)
        patches = mask_to_patch_labels(mask, self.image_size, self.patch, self.pos_frac)
        return {
            "image": chw,
            "residual": residual,
            "patches": patches,
            "has_edit": torch.tensor(1.0 if row.mask_path else 0.0),
            "label": row.label,
            "path": row.path,
        }
