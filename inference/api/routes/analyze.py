import base64
import io
import logging
import os
import time
from pathlib import Path

import numpy as np
import requests
import tensorflow as tf
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image
from scipy import ndimage

from api.models import load_classifier_model, load_localization_model
from api.schemas import AnalyzeRequest, AnalyzeResponse
from fusion.load_config import load_fusion_config
from fusion.policy import fuse
from observability.metrics import AnalyzeMetrics, emit

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
INFERENCE_ROOT = BASE_DIR.parent.parent
IMAGE_SIZE = (224, 224)

CLASSIFIER_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_model_finetuned.weights.h5"
DINOPROBE_CKPT_CANDIDATES = (
    INFERENCE_ROOT / "core/models/ai_detection/best_dinoprobe.pt",
    INFERENCE_ROOT / "core/models/ai_detection/dinoprobe_lora_v2/best.pt",
)
LOCALIZATION_CKPT = INFERENCE_ROOT / "core/models/tamper_localization/best_phase2_dice.h5"
DINOLIZER_CKPT = INFERENCE_ROOT / "core/models/ai_edit_localization/best_dinolizer.pt"

# efficientnet (default) or dinoprobe
CLASSIFIER_BACKEND = os.environ.get("CLASSIFIER_BACKEND", "efficientnet").strip().lower()
if CLASSIFIER_BACKEND not in ("efficientnet", "dinoprobe"):
    logger.warning(
        f"Unknown CLASSIFIER_BACKEND={CLASSIFIER_BACKEND!r}; falling back to efficientnet"
    )
    CLASSIFIER_BACKEND = "efficientnet"

FUSION_CFG = load_fusion_config()
# Checkpoint head order is [ai_generated, real]; report P(AI) = 1 - P(real).
AI_GENERATED_THRESHOLD = FUSION_CFG.ai_threshold
UNCERTAIN_LOW = FUSION_CFG.uncertain_low
MASK_THRESHOLD = FUSION_CFG.mask_threshold
MIN_EDITED_AREA_RATIO = FUSION_CFG.min_edited_area_ratio
MIN_MASK_PIXELS_ABSOLUTE = FUSION_CFG.min_mask_pixels
MORPH_CLOSING_SIZE = 3
CLASSIFIER_MODEL_ID = "baseline_b0"
LOCALIZER_MODEL_ID = "baseline_b0_multihead_mask"

router = APIRouter()

CLASSIFIER_MODEL = None
DINOPROBE_MODEL = None
DINOPROBE_CFG = None
DINOPROBE_DEVICE = "cpu"
LOCALIZATION_MODEL = None
DINOLIZER_MODEL = None
DINOLIZER_CFG = None
DINOLIZER_DEVICE = "cpu"


def _resolve_dinoprobe_ckpt() -> Path | None:
    for p in DINOPROBE_CKPT_CANDIDATES:
        if p.exists():
            return p
    return None


try:
    if CLASSIFIER_BACKEND == "dinoprobe":
        ckpt = _resolve_dinoprobe_ckpt()
        if ckpt is None:
            logger.error(
                "CLASSIFIER_BACKEND=dinoprobe but no checkpoint found at "
                + " or ".join(str(p) for p in DINOPROBE_CKPT_CANDIDATES)
            )
        else:
            import torch
            from classifier.model import load_classifier as load_dinoprobe

            DINOPROBE_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
            DINOPROBE_MODEL, DINOPROBE_CFG = load_dinoprobe(str(ckpt), DINOPROBE_DEVICE)
            CLASSIFIER_MODEL_ID = "dinoprobe_v1"
            logger.info(
                f"Loaded dinoprobe classifier from {ckpt} on {DINOPROBE_DEVICE} "
                f"(CLASSIFIER_BACKEND=dinoprobe)"
            )
    elif CLASSIFIER_CKPT.exists():
        CLASSIFIER_MODEL = load_classifier_model(CLASSIFIER_CKPT, IMAGE_SIZE, strict=True)
        CLASSIFIER_MODEL_ID = "baseline_b0"
    else:
        logger.error(f"Classifier checkpoint not found: {CLASSIFIER_CKPT}")

    # Prefer P3 DinoLizer when available (beats legacy multi-head on AI edits).
    if DINOLIZER_CKPT.exists():
        try:
            import torch
            from localizer.model import load_localizer

            DINOLIZER_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
            DINOLIZER_MODEL, DINOLIZER_CFG = load_localizer(str(DINOLIZER_CKPT), DINOLIZER_DEVICE)
            LOCALIZER_MODEL_ID = "dinolizer_v1"
            logger.info(f"Loaded DinoLizer from {DINOLIZER_CKPT} on {DINOLIZER_DEVICE}")
        except Exception as e:
            logger.warning(f"DinoLizer load failed, falling back to Keras localizer: {e}")

    if DINOLIZER_MODEL is None and LOCALIZATION_CKPT.exists():
        LOCALIZATION_MODEL = load_localization_model(LOCALIZATION_CKPT, IMAGE_SIZE, strict=True)
    elif DINOLIZER_MODEL is None:
        logger.warning(f"Localization checkpoint not found: {LOCALIZATION_CKPT}")

    _dummy = tf.zeros((1, *IMAGE_SIZE, 3), dtype=tf.float32)
    if CLASSIFIER_MODEL is not None:
        CLASSIFIER_MODEL.predict(_dummy, verbose=0)
        logger.info("Classifier model warmup successful")
    if DINOPROBE_MODEL is not None:
        import torch
        from classifier.dataset import imagenet_normalize

        size = int((DINOPROBE_CFG or {}).get("image_size", 224))
        warm = imagenet_normalize(torch.zeros(3, size, size)).unsqueeze(0).to(DINOPROBE_DEVICE)
        with torch.no_grad():
            DINOPROBE_MODEL(warm)
        logger.info("Dinoprobe classifier warmup successful")
    if LOCALIZATION_MODEL is not None:
        LOCALIZATION_MODEL.predict(_dummy, verbose=0)
        logger.info("Localization model warmup successful")
except Exception as e:
    logger.error(f"Failed to load models: {e}")


def preprocess_pil(img: Image.Image):
    img = img.convert("RGB")
    img = img.resize(IMAGE_SIZE, Image.BILINEAR)
    arr = np.asarray(img).astype(np.float32)
    # EfficientNetB0 expects 0-255 float; preprocess_input is a no-op for this family.
    return tf.keras.applications.efficientnet.preprocess_input(arr)


def classify_from_p_ai(p_ai: float) -> dict:
    is_ai = p_ai >= AI_GENERATED_THRESHOLD
    is_uncertain = (not is_ai) and (p_ai >= UNCERTAIN_LOW)
    return {
        "is_ai_generated": bool(is_ai),
        "is_uncertain": bool(is_uncertain),
        "confidence": float(p_ai),
    }


def predict_dinoprobe_p_ai(img: Image.Image) -> float:
    """DINOv2 LoRA probe: sigmoid(logit) = P(AI) (trained fully_synthetic=1)."""
    import torch
    from classifier.dataset import imagenet_normalize

    size = int((DINOPROBE_CFG or {}).get("image_size", 224))
    rgb = img.convert("RGB").resize((size, size), Image.BILINEAR)
    chw = torch.from_numpy(np.asarray(rgb).astype(np.float32) / 255.0).permute(2, 0, 1)
    batch = imagenet_normalize(chw).unsqueeze(0).to(DINOPROBE_DEVICE)
    with torch.no_grad():
        logit = DINOPROBE_MODEL(batch)
        return float(torch.sigmoid(logit).detach().cpu().numpy().reshape(-1)[0])


def postprocess_mask(mask_logit: np.ndarray, original_size: tuple) -> tuple:
    """Threshold at model resolution, then score/export at original pixel size."""
    mask_prob = tf.sigmoid(mask_logit).numpy()
    if mask_prob.ndim == 3:
        mask_prob = mask_prob.squeeze()

    mask_bin_small = (mask_prob > MASK_THRESHOLD).astype(np.uint8)
    if np.any(mask_bin_small):
        structure = np.ones((MORPH_CLOSING_SIZE, MORPH_CLOSING_SIZE), dtype=np.uint8)
        mask_bin_small = ndimage.binary_closing(mask_bin_small, structure=structure).astype(np.uint8)

    ow, oh = original_size  # PIL size is (width, height)
    mask_bin = np.asarray(
        Image.fromarray(mask_bin_small * 255, mode="L").resize((ow, oh), Image.NEAREST)
    )
    mask_bin = (mask_bin > 127).astype(np.uint8)

    n_pixels = int(mask_bin.sum())
    total_pixels = ow * oh
    edited_area_ratio = n_pixels / total_pixels if total_pixels else 0.0
    is_edited = (
        edited_area_ratio >= MIN_EDITED_AREA_RATIO and n_pixels >= MIN_MASK_PIXELS_ABSOLUTE
    )
    return is_edited, mask_bin, edited_area_ratio, n_pixels


def mask_to_base64_png(mask_arr: np.ndarray) -> str:
    if mask_arr.ndim == 3 and mask_arr.shape[-1] == 1:
        mask_arr = mask_arr[..., 0]
    pil = Image.fromarray(mask_arr.astype(np.uint8) * 255, mode="L")
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def classify_logit(logit: float) -> dict:
    p_real = 1.0 / (1.0 + np.exp(-logit))
    p_ai = float(1.0 - p_real)
    is_ai = p_ai >= AI_GENERATED_THRESHOLD
    is_uncertain = (not is_ai) and (p_ai >= UNCERTAIN_LOW)
    return {
        "is_ai_generated": bool(is_ai),
        "is_uncertain": bool(is_uncertain),
        "confidence": p_ai,
    }


def localize_dinolizer(img: Image.Image):
    from localizer.infer import predict_prob_map

    window = int((DINOLIZER_CFG or {}).get("image_size", 392))
    stride = max(window // 2, 1)
    prob = predict_prob_map(DINOLIZER_MODEL, img, DINOLIZER_DEVICE, window=window, stride=stride)
    mask_bin = (prob >= MASK_THRESHOLD).astype(np.uint8)
    if np.any(mask_bin):
        structure = np.ones((MORPH_CLOSING_SIZE, MORPH_CLOSING_SIZE), dtype=np.uint8)
        mask_bin = ndimage.binary_closing(mask_bin, structure=structure).astype(np.uint8)
    n_pixels = int(mask_bin.sum())
    total = mask_bin.size
    ratio = n_pixels / total if total else 0.0
    detected = ratio >= MIN_EDITED_AREA_RATIO and n_pixels >= MIN_MASK_PIXELS_ABSOLUTE
    return detected, mask_bin, ratio, n_pixels


async def process_image(img: Image.Image):
    t0 = time.time()
    original_size = img.size
    batch = None  # Keras path only

    if DINOPROBE_MODEL is not None:
        classification_result = classify_from_p_ai(predict_dinoprobe_p_ai(img))
        classification_result["model_id"] = CLASSIFIER_MODEL_ID
    elif CLASSIFIER_MODEL is not None:
        batch = np.expand_dims(preprocess_pil(img), axis=0)
        class_logit = float(CLASSIFIER_MODEL.predict(batch, verbose=0).flatten()[0])
        classification_result = classify_logit(class_logit)
        classification_result["model_id"] = CLASSIFIER_MODEL_ID
    else:
        raise RuntimeError(
            f"Classifier model not available (CLASSIFIER_BACKEND={CLASSIFIER_BACKEND})"
        )

    mask_bin = None
    if DINOLIZER_MODEL is not None:
        is_edited, mask_bin, edited_area_ratio, n_pixels = localize_dinolizer(img)
        total_pixels = mask_bin.size
    elif LOCALIZATION_MODEL is None:
        logger.warning("Localization model not loaded. Tampering detection skipped.")
        is_edited, edited_area_ratio, n_pixels, total_pixels = False, 0.0, 0, 1
    else:
        if batch is None:
            batch = np.expand_dims(preprocess_pil(img), axis=0)
        mask_logit = LOCALIZATION_MODEL.predict(batch, verbose=0).squeeze()
        is_edited, mask_bin, edited_area_ratio, n_pixels = postprocess_mask(
            mask_logit, original_size
        )
        total_pixels = original_size[0] * original_size[1]

    fused = fuse(
        p_ai=float(classification_result["confidence"]),
        edited_pixels=n_pixels,
        total_pixels=total_pixels,
        cfg=FUSION_CFG,
        classifier_id=CLASSIFIER_MODEL_ID,
        localizer_id=LOCALIZER_MODEL_ID if (DINOLIZER_MODEL is not None or LOCALIZATION_MODEL is not None) else "none",
    )
    # Prefer fusion decision for Q2 (keeps calibrate_decision in one place).
    is_edited = fused.q2.detected
    edited_area_ratio = fused.q2.edited_area_ratio
    classification_result = {
        "is_ai_generated": fused.q1.is_ai_generated,
        "is_uncertain": fused.q1.is_uncertain,
        "confidence": fused.q1.p_ai,
        "model_id": fused.q1.model_id,
    }
    tampering_result = {
        "detected": is_edited,
        "mask_base64": mask_to_base64_png(mask_bin) if (is_edited and mask_bin is not None) else None,
        "edited_area_ratio": float(edited_area_ratio),
        "edited_pixels": fused.q2.edited_pixels,
        "model_id": fused.q2.model_id if fused.q2.model_id != "none" else None,
    }
    emit(AnalyzeMetrics(
        model_id_q1=fused.q1.model_id,
        model_id_q2=tampering_result["model_id"],
        p_ai=fused.q1.p_ai,
        q1_ai=fused.q1.is_ai_generated,
        q1_uncertain=fused.q1.is_uncertain,
        q2_detected=is_edited,
        edited_area_ratio=float(edited_area_ratio),
        edited_pixels=fused.q2.edited_pixels,
        latency_ms=(time.time() - t0) * 1000,
    ))
    return {"predictions": classification_result, "tampering": tampering_result}


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    try:
        response = requests.get(str(request.image_url), timeout=30)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="URL does not point to an image")
        try:
            img = Image.open(io.BytesIO(response.content))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to open image: {e}")
        return AnalyzeResponse(**(await process_image(img)))
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Failed to download image from URL: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {e}")


@router.post("/predict", response_model=AnalyzeResponse)
async def predict(file: UploadFile = File(...)):
    if file.content_type and file.content_type.split("/")[0] != "image":
        raise HTTPException(status_code=400, detail="File is not an image")
    contents = await file.read()
    try:
        img = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open image: {e}")
    return AnalyzeResponse(**(await process_image(img)))
