import logging
from pathlib import Path
import tensorflow as tf
from tensorflow.keras import layers, Model
from tensorflow.keras.applications import EfficientNetB0

logger = logging.getLogger(__name__)


def build_classifier_model(image_size=(224, 224)):
    base = EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*image_size, 3),
    )
    base.trainable = True
    
    inputs = base.input
    x = base.output
    
    x = layers.GlobalAveragePooling2D(name="global_pool")(x)
    x = layers.Dropout(0.3, name="clf_dropout1")(x)
    x = layers.Dense(256, activation="relu", name="clf_dense1")(x)
    x = layers.Dropout(0.2, name="clf_dropout2")(x)
    class_logit = layers.Dense(1, activation=None, dtype="float32", name="class_logit")(x)
    
    model = Model(inputs, class_logit, name="classifier_model")
    
    logger.info(f"Built classifier_model with {model.count_params():,} parameters")
    return model


def build_localization_model(image_size=(224, 224)):
    base = EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*image_size, 3),
    )
    base.trainable = True
    
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
    
    def conv_block(x, filters, name_prefix):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"{name_prefix}_conv1")(x)
        x = layers.BatchNormalization(name=f"{name_prefix}_bn1")(x)
        x = layers.Activation("relu", name=f"{name_prefix}_act1")(x)
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"{name_prefix}_conv2")(x)
        x = layers.BatchNormalization(name=f"{name_prefix}_bn2")(x)
        x = layers.Activation("relu", name=f"{name_prefix}_act2")(x)
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
    
    d = layers.UpSampling2D(size=(2, 2), name="dec_up_final")(d)
    mask_logit = layers.Conv2D(1, 1, padding="same", dtype="float32", name="mask_logit")(d)
    
    model = Model(inputs, mask_logit, name="localization_model")
    
    logger.info(f"Built localization_model with {model.count_params():,} parameters")
    return model


def load_classifier_model(checkpoint_path: Path, image_size=(224, 224), strict=True):
    if not checkpoint_path.exists():
        raise ValueError(f"Classifier checkpoint not found: {checkpoint_path}")
    
    model = build_classifier_model(image_size)
    
    try:
        if strict:
            model.load_weights(str(checkpoint_path))
            logger.info(f"Loaded classifier checkpoint: {checkpoint_path}")
        else:
            model.load_weights(str(checkpoint_path), by_name=True, skip_mismatch=True)
            logger.warning(f"Loaded classifier checkpoint with skip_mismatch: {checkpoint_path}")
    except Exception as e:
        if strict:
            raise ValueError(
                f"Failed to load classifier checkpoint (strict mode): {e}\n"
                f"This checkpoint may be from a multi-head model and is INVALID."
            ) from e
        else:
            logger.warning(f"Partial load with skip_mismatch: {e}")
    
    return model


def load_localization_model(checkpoint_path: Path, image_size=(224, 224), strict=True):
    if not checkpoint_path.exists():
        raise ValueError(f"Localization checkpoint not found: {checkpoint_path}")
    
    model = build_localization_model(image_size)
    
    try:
        if strict:
            model.load_weights(str(checkpoint_path))
            logger.info(f"Loaded localization checkpoint: {checkpoint_path}")
        else:
            model.load_weights(str(checkpoint_path), by_name=True, skip_mismatch=True)
            logger.warning(f"Loaded localization checkpoint with skip_mismatch: {checkpoint_path}")
    except Exception as e:
        if strict:
            raise ValueError(
                f"Failed to load localization checkpoint (strict mode): {e}\n"
                f"This checkpoint may be from a multi-head model and is INVALID."
            ) from e
        else:
            logger.warning(f"Partial load with skip_mismatch: {e}")
    
    return model

