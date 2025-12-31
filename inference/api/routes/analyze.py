import io
import base64
import logging
from pathlib import Path

import numpy as np
import requests
import tensorflow as tf
from fastapi import APIRouter, File, UploadFile, HTTPException
from PIL import Image
from tensorflow.keras import layers, Model

from api.schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
IMAGE_SIZE = (224, 224)
INFERENCE_ROOT = BASE_DIR.parent.parent
CLASSIFIER_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_model_finetuned.weights.h5"
SEG_CKPT = INFERENCE_ROOT / "core/models/tamper_localization/best_phase2_dice.h5"
MASK_THRESHOLD = 0.5

MIN_MASK_PIXEL = 10

router = APIRouter()

def build_multihead_model(image_size=IMAGE_SIZE, load_classifier_ckpt=True):
    base = tf.keras.applications.EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*image_size, 3),
    )
    inputs = base.input

    skip_names = [
        "block2a_expand_activation",
        "block3a_expand_activation",
        "block4a_expand_activation",
        "block6a_expand_activation",
    ]

    skips = []

    for name in skip_names:
        try:
            skips.append(base.get_layer(name).output)
        except Exception:
            pass

    if len(skips) < 4:
        all_layers = base.layers
        candidates = [l.output for l in all_layers if hasattr(l, "output")]
        skips = candidates[-8:-4] if len(candidates) >= 8 else candidates[:4]

    bottleneck = base.output

    x = layers.GlobalAveragePooling2D(name="global_pool")(bottleneck)
    x = layers.Dropout(0.3, name="clf_dropout1")(x)
    x = layers.Dense(256, activation="relu", name="clf_dense1")(x)
    x = layers.Dropout(0.2, name="clf_dropout2")(x)
    class_logit = layers.Dense(1, activation=None, dtype="float32", name="class_logit")(x)

    
    def conv_block(x, filters, name_prefix=None):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=(None if not name_prefix else f"{name_prefix}_conv1"))(x)
        x = layers.BatchNormalization(name=(None if not name_prefix else f"{name_prefix}_bn1"))(x)
        x = layers.Activation("relu", name=(None if not name_prefix else f"{name_prefix}_act1"))(x)
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=(None if not name_prefix else f"{name_prefix}_conv2"))(x)
        x = layers.BatchNormalization(name=(None if not name_prefix else f"{name_prefix}_bn2"))(x)
        x = layers.Activation("relu", name=(None if not name_prefix else f"{name_prefix}_act2"))(x)
        return x    

    d = layers.Conv2D(256, 1, padding="same", name="dec_conv_in")(bottleneck)
    d = layers.UpSampling2D(name="dec_up1")(d)
    if len(skips) >= 1:
        d = layers.Concatenate(name="dec_cat1")([d, skips[-1]])
    d = conv_block(d, 256, name_prefix="dec_block1")

    d = layers.UpSampling2D(name="dec_up2")(d)
    if len(skips) >= 2:
        d = layers.Concatenate(name="dec_cat2")([d, skips[-2]])
    d = conv_block(d, 128, name_prefix="dec_block2")

    d = layers.UpSampling2D(name="dec_up3")(d)
    if len(skips) >= 3:
        d = layers.Concatenate(name="dec_cat3")([d, skips[-3]])
    d = conv_block(d, 64, name_prefix="dec_block3")

    d = layers.UpSampling2D(name="dec_up4")(d)
    if len(skips) >= 4:
        d = layers.Concatenate(name="dec_cat4")([d, skips[-4]])
    d = conv_block(d, 32, name_prefix="dec_block4")

    d = layers.UpSampling2D(size=(2,2), name="dec_up_final")(d)
    mask_logit = layers.Conv2D(1, 1, padding="same", dtype="float32", name="mask_logit")(d)

    model = Model(inputs, [class_logit, mask_logit], name="multihead_model")
    return model

logger.info("Loading model to memory (this may take some time)...")
MODEL: Model = build_multihead_model()

if SEG_CKPT.exists():
    try:
        MODEL.load_weights(str(SEG_CKPT), by_name=True, skip_mismatch=True)
        logger.info("Segmentation checkpoint loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load segmentation checkpoint: {e}")
else:
    logger.warning(f"Segmentation checkpoint not found: {SEG_CKPT}")

if CLASSIFIER_CKPT.exists():
    try:
        MODEL.load_weights(str(CLASSIFIER_CKPT), by_name=True, skip_mismatch=True)
        logger.info("Classifier checkpoint loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load classifier checkpoint: {e}")
else:
    logger.warning(f"Classifier checkpoint not found: {CLASSIFIER_CKPT}")

_dummy = tf.zeros((1, *IMAGE_SIZE, 3), dtype=tf.float32)
try:
    MODEL.predict(_dummy, verbose=0)
    logger.info("Model warmup successful")
except Exception as e:
    logger.error(f"Model warmup failed: {e}")

def preprocess_pil(img: Image.Image):
    img = img.convert("RGB")
    img = img.resize(IMAGE_SIZE, Image.BILINEAR)
    arr = np.asarray(img).astype(np.float32) / 255.0   
    arr = tf.keras.applications.efficientnet.preprocess_input(arr * 255.0)
    return arr

def mask_to_base64_png(mask_arr: np.ndarray):
    if mask_arr.ndim == 3 and mask_arr.shape[-1] == 1:
        mask_arr = mask_arr[..., 0]
    mask_img = (mask_arr > 0.5).astype(np.uint8) * 255
    pil = Image.fromarray(mask_img, mode="L")
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"

async def process_image(img: Image.Image):
    """Process an image and return inference results"""
    arr = preprocess_pil(img)
    batch = np.expand_dims(arr, axis=0)

    class_logit_np, mask_logit_np = MODEL.predict(batch, verbose=0)
    class_logit = float(class_logit_np.flatten()[0])
    class_prob = 1.0 / (1.0 + np.exp(-class_logit))
    is_ai_generated = bool(class_prob > 0.5)

    mask_prob = tf.sigmoid(mask_logit_np).numpy().squeeze()
    mask_bin = (mask_prob > MASK_THRESHOLD).astype(np.uint8)
    n_pixel = int(np.sum(mask_bin))

    is_edited = bool(n_pixel > MIN_MASK_PIXEL)

    mask_base64 = mask_to_base64_png(mask_bin)

    response = {
        "predictions": {
            "is_ai_generated": is_ai_generated,
            "confidence": float(class_prob),
        },
        "tampering": {
            "is_edited": is_edited,
            "mask_pixesls": n_pixel,
            "mask_base64": mask_base64,
        }
    }

    return response

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    """Analyze an image from a URL"""
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
    """Predict from uploaded file"""
    if file.content_type and file.content_type.split("/")[0] != "image":
        raise HTTPException(status_code=400, detail="File is not an image")
    
    contents = await file.read()

    try:
        img = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open image: {e}")

    result = await process_image(img)
    return AnalyzeResponse(**result)
