"""P5 minimal PyTorch localizer smoke server (classifier stays Keras/TF for now).

    cd inference
    .\\.venv-gen\\Scripts\\python serve_pytorch.py
    # POST /localize with multipart file field "image"
"""
from __future__ import annotations

import base64
import io
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, UploadFile
from PIL import Image
from scipy import ndimage

from fusion.load_config import load_fusion_config
from fusion.policy import decide_q2
from localizer.config import CHECKPOINT_DIR
from localizer.infer import predict_prob_map
from localizer.model import load_localizer
from observability.metrics import AnalyzeMetrics, emit

CKPT = CHECKPOINT_DIR / "best_dinolizer.pt"
DEVICE = "cuda"
MORPH = 3
MODEL_ID = "dinolizer_v1"

app = FastAPI(title="ProofOfArt PyTorch localizer", version="0.2")
_model = None
_cfg = None
_fusion = None


@app.on_event("startup")
def _load():
    global _model, _cfg, DEVICE, _fusion
    import torch

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    if not CKPT.exists():
        raise RuntimeError(f"Missing {CKPT}")
    _model, _cfg = load_localizer(str(CKPT), DEVICE)
    _fusion = load_fusion_config()
    print(
        f"loaded {CKPT} dual={_cfg.get('dual_stream')} lora_r={_cfg.get('lora_r')} "
        f"device={DEVICE} thr={_fusion.mask_threshold}"
    )


@app.get("/health")
def health():
    return {
        "ok": True,
        "checkpoint": str(CKPT),
        "model_id": MODEL_ID,
        "dual_stream": bool((_cfg or {}).get("dual_stream")),
        "lora_r": (_cfg or {}).get("lora_r", 0),
        "device": DEVICE,
        "mask_threshold": getattr(_fusion, "mask_threshold", None),
        "min_edited_area_ratio": getattr(_fusion, "min_edited_area_ratio", None),
        "min_mask_pixels": getattr(_fusion, "min_mask_pixels", None),
    }


@app.post("/localize")
async def localize(image: UploadFile = File(...)):
    t0 = time.time()
    raw = await image.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    window = int((_cfg or {}).get("image_size", 392))
    stride = max(window // 2, 1)
    fusion = _fusion or load_fusion_config()
    prob = predict_prob_map(_model, img, DEVICE, window=window, stride=stride)
    binary = (prob >= fusion.mask_threshold).astype(np.uint8)
    if binary.any():
        binary = ndimage.binary_closing(binary, structure=np.ones((MORPH, MORPH))).astype(np.uint8)
    pixels = int(binary.sum())
    q2 = decide_q2(pixels, binary.size, fusion, model_id=MODEL_ID)
    mask_b64 = None
    if q2.detected:
        buf = io.BytesIO()
        Image.fromarray(binary * 255).save(buf, format="PNG")
        mask_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    emit(AnalyzeMetrics(
        event="localize_pytorch",
        model_id_q2=q2.model_id,
        q2_detected=q2.detected,
        edited_area_ratio=q2.edited_area_ratio,
        edited_pixels=q2.edited_pixels,
        latency_ms=(time.time() - t0) * 1000,
    ))
    return {
        "model_id": q2.model_id,
        "detected": q2.detected,
        "edited_area_ratio": q2.edited_area_ratio,
        "edited_pixels": q2.edited_pixels,
        "mask_base64": mask_b64,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8091)
