"""Deterministic real-world degradations applied identically to every model.

Each transform returns (image, mask); geometric ones move the mask with the
pixels, photometric ones leave it untouched. Noise is seeded per image so
reruns are bit-identical.
"""
import hashlib
import io
from typing import Callable, Dict, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter

Pair = Tuple[Image.Image, Optional[Image.Image]]
Transform = Callable[[Image.Image, Optional[Image.Image], str], Pair]


def _seed(key: str) -> int:
    return int.from_bytes(hashlib.sha1(key.encode()).digest()[:4], "big")


def _jpeg(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _resize(img: Image.Image, mask: Optional[Image.Image], scale: float) -> Pair:
    w, h = img.size
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    out_mask = mask.resize(size, Image.NEAREST) if mask is not None else None
    return img.resize(size, Image.BICUBIC), out_mask


def clean(img, mask, key):
    return img, mask


def jpeg(q: int) -> Transform:
    return lambda img, mask, key: (_jpeg(img, q), mask)


def resize(scale: float) -> Transform:
    return lambda img, mask, key: _resize(img, mask, scale)


def blur(radius: float) -> Transform:
    return lambda img, mask, key: (img.filter(ImageFilter.GaussianBlur(radius)), mask)


def noise(sigma: float) -> Transform:
    def apply(img, mask, key):
        rng = np.random.default_rng(_seed(f"noise:{key}"))
        arr = np.asarray(img.convert("RGB"), dtype=np.float32)
        arr = np.clip(arr + rng.normal(0, sigma, arr.shape), 0, 255).astype(np.uint8)
        return Image.fromarray(arr), mask
    return apply


def center_crop(frac: float) -> Transform:
    def apply(img, mask, key):
        w, h = img.size
        cw, ch = max(1, round(w * frac)), max(1, round(h * frac))
        box = ((w - cw) // 2, (h - ch) // 2, (w - cw) // 2 + cw, (h - ch) // 2 + ch)
        return img.crop(box), (mask.crop(box) if mask is not None else None)
    return apply


def social(max_side: int = 1080, quality: int = 75) -> Transform:
    """Messenger/social upload: downscale long side then recompress."""
    def apply(img, mask, key):
        w, h = img.size
        scale = min(1.0, max_side / max(w, h))
        if scale < 1.0:
            img, mask = _resize(img, mask, scale)
        return _jpeg(img, quality), mask
    return apply


DEGRADATIONS: Dict[str, Transform] = {
    "clean": clean,
    "jpeg90": jpeg(90),
    "jpeg70": jpeg(70),
    "jpeg50": jpeg(50),
    "resize0.5": resize(0.5),
    "resize0.9": resize(0.9),
    "blur1": blur(1.0),
    "noise5": noise(5.0),
    "crop0.8": center_crop(0.8),
    "social": social(),
}

QUICK_DEGRADATIONS = ["clean", "jpeg70", "resize0.5", "social"]
