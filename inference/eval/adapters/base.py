import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Set

import numpy as np
from PIL import Image


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class DecisionConfig:
    """Operating point the production API applies on top of raw scores."""
    ai_threshold: float = 0.5
    mask_threshold: float = 0.5
    min_edited_area_ratio: float = 0.001
    min_mask_pixels: int = 10
    morph_closing: int = 3


@dataclass
class ModelInfo:
    name: str
    architecture: str
    checkpoint: str
    checkpoint_sha256: str
    input_size: Optional[int]
    notes: List[str] = field(default_factory=list)


class ClassifierAdapter(ABC):
    batch_size: int = 32
    decision: DecisionConfig = DecisionConfig()

    @abstractmethod
    def info(self) -> ModelInfo: ...

    @abstractmethod
    def predict_proba(self, images: List[Image.Image]) -> np.ndarray:
        """P(fully synthetic) per image, shape (N,)."""

    def seen_paths(self) -> Optional[Set[str]]:
        """Inference-relative paths used for training/selection, or None if unknown."""
        return None


class LocalizerAdapter(ABC):
    batch_size: int = 16
    decision: DecisionConfig = DecisionConfig()

    @abstractmethod
    def info(self) -> ModelInfo: ...

    @abstractmethod
    def predict_prob_maps(self, images: List[Image.Image]) -> List[np.ndarray]:
        """Per-pixel P(edited) at any resolution; the harness resizes to native."""

    def seen_paths(self) -> Optional[Set[str]]:
        return None
