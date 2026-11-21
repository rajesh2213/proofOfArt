"""Q1 samples: pristine_real (0) vs fully_synthetic (1)."""
from __future__ import annotations

import io
from typing import Optional

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import Dataset

from classifier.config import INFERENCE_ROOT, JPEG_PROB, MAX_PER_CLASS, UNIFIED_MANIFEST

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def imagenet_normalize(chw: torch.Tensor) -> torch.Tensor:
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
    return (chw - mean) / std


def load_rows(split: str, max_per_class: Optional[int] = MAX_PER_CLASS, seed: int = 0) -> pd.DataFrame:
    df = pd.read_csv(UNIFIED_MANIFEST, keep_default_na=False)
    df = df[df["split"] == split]
    df = df[df["label"].isin(["pristine_real", "fully_synthetic"])].copy()
    df["y"] = (df["label"] == "fully_synthetic").astype(int)
    if max_per_class is None:
        return df.sample(frac=1, random_state=seed).reset_index(drop=True)
    parts = []
    rng = np.random.default_rng(seed)
    for _, g in df.groupby("label"):
        if len(g) <= max_per_class:
            parts.append(g)
        else:
            idx = rng.choice(len(g), size=max_per_class, replace=False)
            parts.append(g.iloc[idx])
    return pd.concat(parts, ignore_index=True).sample(frac=1, random_state=seed).reset_index(drop=True)


class WholeImageDataset(Dataset):
    def __init__(self, rows: pd.DataFrame, image_size: int, train: bool = False, jpeg_prob: float = JPEG_PROB):
        self.rows = rows
        self.image_size = image_size
        self.train = train
        self.jpeg_prob = jpeg_prob
        self.rng = np.random.default_rng(0)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx: int):
        r = self.rows.iloc[idx]
        img = Image.open(INFERENCE_ROOT / r.path).convert("RGB")
        img = img.resize((self.image_size, self.image_size), Image.BILINEAR)
        if self.train and self.rng.random() < self.jpeg_prob:
            buf = io.BytesIO()
            q = int(self.rng.integers(40, 95))
            img.save(buf, format="JPEG", quality=q)
            buf.seek(0)
            img = Image.open(buf).convert("RGB")
        if self.train and self.rng.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        chw = torch.from_numpy(np.asarray(img).astype(np.float32) / 255.0).permute(2, 0, 1)
        return {
            "image": imagenet_normalize(chw),
            "y": torch.tensor(float(r.y), dtype=torch.float32),
            "path": r.path,
        }
