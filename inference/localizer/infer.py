"""Sliding-window inference for the P3 patch localizer."""
from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np
import torch
from PIL import Image

from localizer.dataset import imagenet_normalize
from localizer.model import DinoPatchLocalizer
from localizer.residual import highpass_residual


def _windows(h: int, w: int, size: int, stride: int) -> List[Tuple[int, int, int, int]]:
    ys = list(range(0, max(1, h - size + 1), stride))
    xs = list(range(0, max(1, w - size + 1), stride))
    if not ys or ys[-1] + size < h:
        ys.append(max(0, h - size))
    if not xs or xs[-1] + size < w:
        xs.append(max(0, w - size))
    # Deduplicate while preserving order
    seen, boxes = set(), []
    for y0 in ys:
        for x0 in xs:
            box = (y0, x0, y0 + size, x0 + size)
            if box not in seen:
                seen.add(box)
                boxes.append(box)
    return boxes


@torch.no_grad()
def predict_prob_map(
    model: DinoPatchLocalizer,
    image: Image.Image,
    device: str,
    window: int = 518,
    stride: int = 259,
) -> np.ndarray:
    """Return a native-resolution P(edited) map by averaging overlapping windows."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    # Small images: single center resize.
    if max(h, w) <= window:
        canvas = Image.new("RGB", (window, window), (0, 0, 0))
        canvas.paste(rgb, (0, 0))
        chw01 = torch.from_numpy(np.asarray(canvas).astype(np.float32) / 255.0).permute(2, 0, 1)
        chw = imagenet_normalize(chw01)
        res = highpass_residual(chw01)[None].to(device) if getattr(model, "dual_stream", False) else None
        probs = model(chw[None].to(device), residual=res).probs[0].cpu().numpy()
        patch = model.patch
        up = np.asarray(
            Image.fromarray((probs * 255).astype(np.uint8)).resize(
                (window, window), Image.BILINEAR
            )
        ).astype(np.float32) / 255.0
        return up[:h, :w]

    acc = np.zeros((h, w), dtype=np.float32)
    weight = np.zeros((h, w), dtype=np.float32)
    for y0, x0, y1, x1 in _windows(h, w, window, stride):
        crop = rgb.crop((x0, y0, x1, y1))
        if crop.size != (window, window):
            # Edge pad to square window
            pad = Image.new("RGB", (window, window), (0, 0, 0))
            pad.paste(crop, (0, 0))
            crop = pad
        chw01 = torch.from_numpy(np.asarray(crop).astype(np.float32) / 255.0).permute(2, 0, 1)
        chw = imagenet_normalize(chw01)
        res = highpass_residual(chw01)[None].to(device) if getattr(model, "dual_stream", False) else None
        probs = model(chw[None].to(device), residual=res).probs[0].cpu().numpy()
        up = np.asarray(
            Image.fromarray((probs * 255).astype(np.uint8)).resize(
                (window, window), Image.BILINEAR
            )
        ).astype(np.float32) / 255.0
        ch, cw = min(window, h - y0), min(window, w - x0)
        acc[y0:y0 + ch, x0:x0 + cw] += up[:ch, :cw]
        weight[y0:y0 + ch, x0:x0 + cw] += 1.0
    return acc / np.maximum(weight, 1e-6)
