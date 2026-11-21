"""High-pass residual used as the second stream for dual-stream localization."""
from __future__ import annotations

import torch
import torch.nn.functional as F


def _gaussian_kernel(ks: int = 5, sigma: float = 1.0, device=None, dtype=None) -> torch.Tensor:
    ax = torch.arange(ks, device=device, dtype=dtype) - ks // 2
    xx, yy = torch.meshgrid(ax, ax, indexing="ij")
    ker = torch.exp(-(xx**2 + yy**2) / (2 * sigma**2))
    ker = ker / ker.sum()
    return ker.view(1, 1, ks, ks)


def highpass_residual(chw: torch.Tensor, ks: int = 5, sigma: float = 1.2) -> torch.Tensor:
    """chw: (B,3,H,W) or (3,H,W) in roughly [0,1] or ImageNet-normalized space.

    Returns a zero-mean-ish high-pass residual with the same shape.
    """
    single = chw.ndim == 3
    if single:
        chw = chw.unsqueeze(0)
    b, c, h, w = chw.shape
    ker = _gaussian_kernel(ks, sigma, device=chw.device, dtype=chw.dtype).repeat(c, 1, 1, 1)
    blur = F.conv2d(chw, ker, padding=ks // 2, groups=c)
    res = chw - blur
    return res.squeeze(0) if single else res
