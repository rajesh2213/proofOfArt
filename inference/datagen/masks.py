"""Edit-region masks that look like what real users select.

- instance: a detected object, dilated so removals also cover edges and shadows
- bbox:     lasso/rectangle selection around a detected object
- brush:    free-form eraser strokes (LaMa-style), used when nothing is detected
"""
from dataclasses import dataclass
from typing import List, Optional

import cv2
import numpy as np
from PIL import Image

MIN_AREA = 0.005
MAX_AREA = 0.35
DETECT_MAX_SIDE = 800
MIN_SCORE = 0.6


@dataclass
class MaskSpec:
    mask: np.ndarray            # bool, HxW at the image's native resolution
    kind: str                   # instance | bbox | brush
    object_class: str = ""
    score: float = 0.0

    @property
    def ratio(self) -> float:
        return float(self.mask.mean())


def dilate(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0


def brush_mask(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    """Random thick strokes covering roughly 2-20% of the image."""
    mask = np.zeros((h, w), np.uint8)
    target = rng.uniform(0.02, 0.20)
    side = min(h, w)
    for _ in range(40):
        if mask.mean() / 255 >= target:
            break
        n_vertex = int(rng.integers(3, 9))
        width = int(rng.uniform(0.03, 0.10) * side)
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        for _ in range(n_vertex):
            angle = rng.uniform(0, 2 * np.pi)
            length = rng.uniform(0.05, 0.25) * side
            nx = int(np.clip(x + length * np.cos(angle), 0, w - 1))
            ny = int(np.clip(y + length * np.sin(angle), 0, h - 1))
            cv2.line(mask, (x, y), (nx, ny), 255, width)
            cv2.circle(mask, (nx, ny), width // 2, 255, -1)
            x, y = nx, ny
    return mask > 0


def bbox_of(mask: np.ndarray, pad_frac: float = 0.08) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    h, w = mask.shape
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    py, px = int((y1 - y0) * pad_frac), int((x1 - x0) * pad_frac)
    out = np.zeros_like(mask, dtype=bool)
    out[max(0, y0 - py):min(h, y1 + py + 1), max(0, x0 - px):min(w, x1 + px + 1)] = True
    return out


class InstanceDetector:
    """torchvision Mask R-CNN (COCO). Class names double as edit prompts."""

    def __init__(self, device: str):
        import torch
        from torchvision.models.detection import MaskRCNN_ResNet50_FPN_V2_Weights, maskrcnn_resnet50_fpn_v2

        weights = MaskRCNN_ResNet50_FPN_V2_Weights.DEFAULT
        self.categories = weights.meta["categories"]
        self.model = maskrcnn_resnet50_fpn_v2(weights=weights).eval().to(device)
        self.device = device
        self.torch = torch

    def candidates(self, img: Image.Image) -> List[MaskSpec]:
        torch = self.torch
        w, h = img.size
        scale = min(1.0, DETECT_MAX_SIDE / max(w, h))
        small = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR) if scale < 1 else img
        tensor = torch.from_numpy(np.asarray(small.convert("RGB"))).permute(2, 0, 1).float().div(255).to(self.device)
        with torch.inference_mode():
            out = self.model([tensor])[0]
        specs = []
        for m, label, score in zip(out["masks"], out["labels"], out["scores"]):
            if float(score) < MIN_SCORE:
                continue
            m_small = (m[0] > 0.5).cpu().numpy().astype(np.uint8) * 255
            full = np.asarray(Image.fromarray(m_small).resize((w, h), Image.NEAREST)) > 127
            ratio = full.mean()
            if MIN_AREA <= ratio <= MAX_AREA:
                specs.append(MaskSpec(full, "instance", self.categories[int(label)], float(score)))
        return specs


def choose_mask(img: Image.Image, detector: Optional[InstanceDetector], rng: np.random.Generator,
                prefer: str = "instance") -> MaskSpec:
    """Pick an edit region: a detected object when possible, otherwise brush strokes."""
    w, h = img.size
    cands = detector.candidates(img) if detector is not None and prefer != "brush" else []
    if cands:
        spec = cands[int(rng.integers(0, len(cands)))]
        grow = int(rng.uniform(0.005, 0.02) * min(w, h)) + 2
        mask = dilate(spec.mask, grow)
        if prefer == "bbox" or rng.random() < 0.2:
            return MaskSpec(bbox_of(mask), "bbox", spec.object_class, spec.score)
        return MaskSpec(mask, "instance", spec.object_class, spec.score)
    return MaskSpec(brush_mask(h, w, rng), "brush")
