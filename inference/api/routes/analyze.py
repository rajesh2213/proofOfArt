import io
import base64
import logging
from pathlib import Path

import numpy as np
import requests
import tensorflow as tf
from fastapi import APIRouter, File, UploadFile, HTTPException
from PIL import Image
from scipy import ndimage

from api.schemas import AnalyzeRequest, AnalyzeResponse
from api.models import load_classifier_model, load_localization_model

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
IMAGE_SIZE = (224, 224)
INFERENCE_ROOT = BASE_DIR.parent.parent

CLASSIFIER_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_classifier_finetuned.weights.h5"
LOCALIZATION_CKPT = INFERENCE_ROOT / "core/models/tamper_localization/best_localization_phase2.weights.h5"

AI_GENERATED_THRESHOLD = 0.6
MASK_THRESHOLD = 0.5
MIN_EDITED_AREA_RATIO = 0.001
MIN_MASK_PIXELS_ABSOLUTE = 10
MORPH_CLOSING_SIZE = 3

router = APIRouter()

CLASSIFIER_MODEL = None
LOCALIZATION_MODEL = None

try:
    if CLASSIFIER_CKPT.exists():
        CLASSIFIER_MODEL = load_classifier_model(CLASSIFIER_CKPT, IMAGE_SIZE, strict=False)
    else:
        logger.error(f"Classifier checkpoint not found: {CLASSIFIER_CKPT}")
    
    if LOCALIZATION_CKPT.exists():
        LOCALIZATION_MODEL = load_localization_model(LOCALIZATION_CKPT, IMAGE_SIZE, strict=False)
    else:
        logger.warning(f"Localization checkpoint not found: {LOCALIZATION_CKPT}")
    
    _dummy = tf.zeros((1, *IMAGE_SIZE, 3), dtype=tf.float32)
    
    if CLASSIFIER_MODEL is not None:
        try:
            CLASSIFIER_MODEL.predict(_dummy, verbose=0)
            logger.info("Classifier model warmup successful")
        except Exception as e:
            logger.error(f"Classifier model warmup failed: {e}")

    if LOCALIZATION_MODEL is not None:
        try:
            LOCALIZATION_MODEL.predict(_dummy, verbose=0)
            logger.info("Localization model warmup successful")
        except Exception as e:
            logger.error(f"Localization model warmup failed: {e}")

except Exception as e:
    logger.error(f"Failed to load models: {e}")


def preprocess_pil(img: Image.Image):
    img = img.convert("RGB")
    img = img.resize(IMAGE_SIZE, Image.BILINEAR)
    arr = np.asarray(img).astype(np.float32) / 255.0   
    arr = tf.keras.applications.efficientnet.preprocess_input(arr * 255.0)
    return arr


def postprocess_mask(mask_logit: np.ndarray, original_size: tuple) -> tuple:
    mask_prob = tf.sigmoid(mask_logit).numpy()
    
    if mask_prob.ndim == 3:
        mask_prob = mask_prob.squeeze()
    
    mask_bin = (mask_prob > MASK_THRESHOLD).astype(np.uint8)
    
    if np.any(mask_bin):
        structure = np.ones((MORPH_CLOSING_SIZE, MORPH_CLOSING_SIZE), dtype=np.uint8)
        mask_bin = ndimage.binary_closing(mask_bin, structure=structure).astype(np.uint8)
    
    n_pixels = int(np.sum(mask_bin))
    total_pixels = original_size[0] * original_size[1]
    edited_area_ratio = n_pixels / total_pixels if total_pixels > 0 else 0.0
    
    is_edited = (
        edited_area_ratio >= MIN_EDITED_AREA_RATIO and
        n_pixels >= MIN_MASK_PIXELS_ABSOLUTE
    )
    
    return is_edited, mask_bin, edited_area_ratio, n_pixels


def mask_to_base64_png(mask_arr: np.ndarray) -> str:
    if mask_arr.ndim == 3 and mask_arr.shape[-1] == 1:
        mask_arr = mask_arr[..., 0]
    
    mask_img = mask_arr.astype(np.uint8) * 255
    pil = Image.fromarray(mask_img, mode="L")
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


async def process_image(img: Image.Image):
    original_size = img.size
    arr = preprocess_pil(img)
    batch = np.expand_dims(arr, axis=0)

    classification_result = None
    if CLASSIFIER_MODEL is None:
        logger.error("Classifier model not loaded. Classification skipped.")
        raise RuntimeError("Classifier model not available")
    else:
        class_logit_np = CLASSIFIER_MODEL.predict(batch, verbose=0)
        class_logit = float(class_logit_np.flatten()[0])
        class_prob = 1.0 / (1.0 + np.exp(-class_logit))
        is_ai_generated = bool(class_prob > AI_GENERATED_THRESHOLD)
        
        classification_result = {
            "is_ai_generated": is_ai_generated,
            "is_uncertain": False,
            "confidence": float(class_prob),
        }
    
    tampering_result = None
    if LOCALIZATION_MODEL is None:
        logger.warning("Localization model not loaded. Tampering detection skipped.")
        tampering_result = {
            "detected": False,
            "mask_base64": None,
            "edited_area_ratio": 0.0,
            "edited_pixels": 0,
        }
    else:
        mask_logit_np = LOCALIZATION_MODEL.predict(batch, verbose=0)
        mask_logit = mask_logit_np.squeeze()
        
        is_edited, mask_bin, edited_area_ratio, n_pixels = postprocess_mask(
            mask_logit, 
            (IMAGE_SIZE[0], IMAGE_SIZE[1])
        )
        
        mask_base64 = mask_to_base64_png(mask_bin) if is_edited else None
        
        tampering_result = {
            "detected": is_edited,
            "mask_base64": mask_base64,
            "edited_area_ratio": float(edited_area_ratio),
            "edited_pixels": n_pixels,
        }

    response = {
        "predictions": classification_result,
        "tampering": tampering_result,
    }

    return response


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    try:
        response = requests.get(str(request.image_url), timeout=30)
        response.raise_for_status()
        
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="URL does not point to an image")
        
        try:
            img = Image.open(io.BytesIO(response.content))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to open image: {e}")
        
        result = await process_image(img)
        return AnalyzeResponse(**result) 
        
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

    result = await process_image(img)
    return AnalyzeResponse(**result)
