"""Local editors. Each returns the edited image at native resolution plus the
ground-truth mask of pixels it actually replaced.

AI editors (LaMa, SD inpainting) run on a context crop around the mask and are
composited back with a feathered alpha, like Photoshop generative fill or
phone "magic eraser" tools. With composite=False the SD output replaces the
whole crop, reproducing tools that re-encode everything through the VAE.
"""
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from datagen.masks import MaskSpec, dilate

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
LAMA_PATH = MODELS_DIR / "lama" / "big-lama.pt"
LAMA_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
SD_INPAINT_DIR = MODELS_DIR / "sd2_inpaint"

COCO_REPLACEMENTS = [
    "dog", "cat", "bicycle", "potted plant", "chair", "vase", "backpack", "umbrella", "bench", "suitcase",
    "teddy bear", "bird", "car", "motorcycle", "horse", "clock", "lamp", "bucket", "rock", "tree stump",
]


@dataclass
class EditResult:
    image: Image.Image
    gt_mask: np.ndarray
    meta: Dict = field(default_factory=dict)


def context_box(mask: np.ndarray, min_side: int = 512, expand: float = 1.0) -> Tuple[int, int, int, int]:
    """Square crop around the mask bbox, expanded for context and clipped to the image."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    side = max(ys.max() - ys.min(), xs.max() - xs.min()) * (1 + 2 * expand)
    side = int(min(max(side, min_side), h, w))
    x0 = int(np.clip(cx - side / 2, 0, max(0, w - side)))
    y0 = int(np.clip(cy - side / 2, 0, max(0, h - side)))
    return x0, y0, x0 + side, y0 + side


def feather_alpha(mask: np.ndarray, px: int) -> np.ndarray:
    """Alpha that is 1 inside the mask and fades to 0 over `px` pixels outside it."""
    if px <= 0:
        return mask.astype(np.float32)
    grown = dilate(mask, px).astype(np.float32)
    alpha = cv2.GaussianBlur(grown, (0, 0), sigmaX=px / 2)
    return np.maximum(alpha, mask.astype(np.float32))


def composite(original: Image.Image, patch: Image.Image, box, mask: np.ndarray, feather_px: int) -> EditResult:
    base = np.asarray(original.convert("RGB"), dtype=np.float32)
    layer = base.copy()
    x0, y0, x1, y1 = box
    layer[y0:y1, x0:x1] = np.asarray(patch.convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), dtype=np.float32)
    alpha = feather_alpha(mask, feather_px)[..., None]
    out = np.clip(base * (1 - alpha) + layer * alpha, 0, 255).astype(np.uint8)
    return EditResult(Image.fromarray(out), alpha[..., 0] >= 0.5, {"feather_px": feather_px, "composite": True})


class LamaRemover:
    name, operation = "lama", "object_removal"

    def __init__(self, device: str):
        import torch

        if not LAMA_PATH.exists():
            LAMA_PATH.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(LAMA_URL, LAMA_PATH)
        self.torch = torch
        self.device = device
        self.model = torch.jit.load(str(LAMA_PATH), map_location=device).eval()

    def edit(self, img: Image.Image, spec: MaskSpec, rng: np.random.Generator) -> EditResult:
        torch = self.torch
        box = context_box(spec.mask, min_side=384, expand=0.75)
        x0, y0, x1, y1 = box
        crop = img.crop(box).convert("RGB")
        crop_mask = spec.mask[y0:y1, x0:x1]
        work = min(768, max(crop.size))
        size = (max(8, round(crop.size[0] * work / max(crop.size) / 8) * 8),
                max(8, round(crop.size[1] * work / max(crop.size) / 8) * 8))
        im = torch.from_numpy(np.asarray(crop.resize(size, Image.BICUBIC)).copy()).permute(2, 0, 1)[None].float().div(255)
        mk = torch.from_numpy((np.asarray(Image.fromarray(crop_mask.astype(np.uint8) * 255).resize(size, Image.NEAREST)) > 127)
                              .astype(np.float32).copy())[None, None]
        with torch.inference_mode():
            out = self.model(im.to(self.device), mk.to(self.device))[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy()
        patch = Image.fromarray((out * 255).astype(np.uint8))
        res = composite(img, patch, box, spec.mask, feather_px=int(rng.integers(2, 9)))
        res.meta.update(operation=self.operation, work_size=list(size))
        return res


class SDInpainter:
    name = "sd15_inpaint"

    def __init__(self, device: str, steps: int = 25, offload: bool = False):
        import torch
        from diffusers import DPMSolverMultistepScheduler, StableDiffusionInpaintPipeline

        dtype = torch.float16 if device == "cuda" else torch.float32
        kwargs = {"dtype": dtype}
        if device == "cuda":
            kwargs["variant"] = "fp16"
        pipe = StableDiffusionInpaintPipeline.from_pretrained(str(SD_INPAINT_DIR), **kwargs)
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
        pipe.enable_attention_slicing()
        pipe.set_progress_bar_config(disable=True)
        if offload and device == "cuda":
            pipe.enable_model_cpu_offload()
        else:
            pipe = pipe.to(device)
        self.pipe, self.torch, self.device, self.steps = pipe, torch, device, steps

    def edit(self, img: Image.Image, spec: MaskSpec, rng: np.random.Generator, operation: str,
             domain: str, composite_result: bool = True) -> Optional[EditResult]:
        medium = "painting" if domain == "wikiart" else "photo"
        obj = spec.object_class or "object"
        if operation == "object_replace":
            new = str(rng.choice([c for c in COCO_REPLACEMENTS if c != obj]))
            prompt, negative = f"a {new}, {medium}, natural lighting, high detail", "blurry, deformed, low quality"
        elif operation == "object_removal":
            prompt = f"empty background, seamless continuation of the scene, {medium}"
            negative = f"{obj}, person, animal, object, text, watermark, blurry"
        else:
            prompt, negative = f"high quality {medium}, detailed, natural", "blurry, deformed, low quality, text"

        box = context_box(spec.mask, min_side=512, expand=0.6)
        x0, y0, x1, y1 = box
        crop = img.crop(box).convert("RGB").resize((512, 512), Image.LANCZOS)
        crop_mask = Image.fromarray(spec.mask[y0:y1, x0:x1].astype(np.uint8) * 255).resize((512, 512), Image.NEAREST)
        seed = int(rng.integers(0, 2**31 - 1))
        guidance = float(rng.uniform(5.0, 9.0))
        generator = self.torch.Generator(device="cpu").manual_seed(seed)
        out = self.pipe(prompt=prompt, negative_prompt=negative, image=crop, mask_image=crop_mask,
                        num_inference_steps=self.steps, guidance_scale=guidance, generator=generator)
        if getattr(out, "nsfw_content_detected", None) and any(out.nsfw_content_detected):
            return None
        patch = out.images[0]
        meta = {"operation": operation, "prompt": prompt, "negative_prompt": negative, "seed": seed,
                "steps": self.steps, "guidance": round(guidance, 2)}
        if composite_result:
            res = composite(img, patch, box, spec.mask, feather_px=int(rng.integers(3, 12)))
        else:
            base = img.convert("RGB").copy()
            base.paste(patch.resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0))
            res = EditResult(base, spec.mask.copy(), {"feather_px": 0, "composite": False})
        res.meta.update(meta)
        return res


class OpenCVInpainter:
    """Classical diffusion-based fill (Telea / Navier-Stokes): a non-AI removal."""
    name, operation = "opencv_inpaint", "object_removal"

    def edit(self, img: Image.Image, spec: MaskSpec, rng: np.random.Generator) -> EditResult:
        method = cv2.INPAINT_TELEA if rng.random() < 0.5 else cv2.INPAINT_NS
        radius = int(rng.integers(3, 10))
        bgr = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)
        out = cv2.inpaint(bgr, spec.mask.astype(np.uint8) * 255, radius, method)
        return EditResult(Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)), spec.mask.copy(),
                          {"operation": self.operation, "composite": True, "feather_px": 0,
                           "method": "telea" if method == cv2.INPAINT_TELEA else "ns", "radius": radius})


class CopyMove:
    """Clone-stamp style: cover the region with a patch copied from elsewhere in the image."""
    name, operation = "copy_move", "copy_move"

    def edit(self, img: Image.Image, spec: MaskSpec, rng: np.random.Generator) -> Optional[EditResult]:
        arr = np.asarray(img.convert("RGB"))
        h, w = spec.mask.shape
        ys, xs = np.nonzero(spec.mask)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        bh, bw = y1 - y0, x1 - x0
        for _ in range(20):
            sy, sx = int(rng.integers(0, max(1, h - bh))), int(rng.integers(0, max(1, w - bw)))
            if abs(sy - y0) > bh or abs(sx - x0) > bw:
                break
        else:
            return None
        patch = arr.copy()
        patch[y0:y1, x0:x1] = arr[sy:sy + bh, sx:sx + bw]
        res = composite(img, Image.fromarray(patch), (0, 0, w, h), spec.mask, feather_px=int(rng.integers(1, 6)))
        res.meta.update(operation=self.operation, source_offset=[int(sx - x0), int(sy - y0)])
        return res
