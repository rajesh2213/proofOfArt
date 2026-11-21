"""Model builders and checkpoint loaders for the inference API.

The on-disk classifier (`best_model_finetuned.weights.h5`) was trained with a
*nested* EfficientNetB0 Functional graph and Keras class order
`['ai_generated', 'real']` (logit = P(real)). The on-disk localizer
(`best_phase2_dice.h5`) is a Keras 2.10 multi-head checkpoint; we load only
the mask branch by layer name.
"""
import logging
import os
import re
import tempfile
from pathlib import Path

import h5py
import numpy as np
import tensorflow as tf
from tensorflow.keras import Model, layers
from tensorflow.keras.applications import EfficientNetB0

logger = logging.getLogger(__name__)


def build_classifier_model(image_size=(224, 224)):
    """Standalone flat classifier (for future retrains). Not used by the current checkpoint."""
    base = EfficientNetB0(weights="imagenet", include_top=False, input_shape=(*image_size, 3))
    base.trainable = True
    x = layers.GlobalAveragePooling2D(name="global_pool")(base.output)
    x = layers.Dropout(0.3, name="clf_dropout1")(x)
    x = layers.Dense(256, activation="relu", name="clf_dense1")(x)
    x = layers.Dropout(0.2, name="clf_dropout2")(x)
    class_logit = layers.Dense(1, activation=None, dtype="float32", name="class_logit")(x)
    return Model(base.input, class_logit, name="classifier_model")


def build_classifier_model_from_checkpoint(image_size=(224, 224)):
    """Graph that matches `best_model_finetuned.weights.h5` (nested EfficientNet)."""
    inputs = layers.Input(shape=(*image_size, 3))
    base = EfficientNetB0(weights=None, include_top=False, input_shape=(*image_size, 3))
    x = base(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(1, dtype="float32")(x)
    model = Model(inputs, outputs, name="classifier_model_nested")
    logger.info(f"Built nested classifier with {model.count_params():,} parameters")
    return model


def build_localization_model(image_size=(224, 224)):
    base = EfficientNetB0(weights="imagenet", include_top=False, input_shape=(*image_size, 3))
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
        candidates = [l.output for l in base.layers if hasattr(l, "output")]
        skips = candidates[-8:-4] if len(candidates) >= 8 else candidates[:4]

    def conv_block(x, filters, name_prefix):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"{name_prefix}_conv1")(x)
        x = layers.BatchNormalization(name=f"{name_prefix}_bn1")(x)
        x = layers.Activation("relu", name=f"{name_prefix}_act1")(x)
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"{name_prefix}_conv2")(x)
        x = layers.BatchNormalization(name=f"{name_prefix}_bn2")(x)
        x = layers.Activation("relu", name=f"{name_prefix}_act2")(x)
        return x

    d = layers.Conv2D(256, 1, padding="same", name="dec_conv_in")(base.output)
    d = layers.UpSampling2D(name="dec_up1")(d)
    if len(skips) >= 1:
        d = layers.Concatenate(name="dec_cat1")([d, skips[-1]])
    d = conv_block(d, 256, "dec_block1")
    d = layers.UpSampling2D(name="dec_up2")(d)
    if len(skips) >= 2:
        d = layers.Concatenate(name="dec_cat2")([d, skips[-2]])
    d = conv_block(d, 128, "dec_block2")
    d = layers.UpSampling2D(name="dec_up3")(d)
    if len(skips) >= 3:
        d = layers.Concatenate(name="dec_cat3")([d, skips[-3]])
    d = conv_block(d, 64, "dec_block3")
    d = layers.UpSampling2D(name="dec_up4")(d)
    if len(skips) >= 4:
        d = layers.Concatenate(name="dec_cat4")([d, skips[-4]])
    d = conv_block(d, 32, "dec_block4")
    d = layers.UpSampling2D(size=(2, 2), name="dec_up_final")(d)
    mask_logit = layers.Conv2D(1, 1, padding="same", dtype="float32", name="mask_logit")(d)
    model = Model(inputs, mask_logit, name="localization_model")
    logger.info(f"Built localization_model with {model.count_params():,} parameters")
    return model


def _normalize_keras3_weights(src: Path) -> Path:
    """Rewrite Windows backslash group paths so Keras 3 can load the file."""
    dst = Path(tempfile.gettempdir()) / f"poa_api_{src.stem}.weights.h5"
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst
    tmp = dst.with_suffix(".tmp")
    with h5py.File(src, "r") as fi, h5py.File(tmp, "w") as fo:
        for k, v in fi.attrs.items():
            fo.attrs[k] = v

        def copy(name, obj):
            target = name.replace("\\", "/")
            if isinstance(obj, h5py.Dataset):
                fo.create_dataset(target, data=obj[()])
            else:
                grp = fo.require_group(target)
                for k, v in obj.attrs.items():
                    grp.attrs[k] = v

        fi.visititems(copy)
    os.replace(tmp, dst)
    return dst


def load_classifier_model(checkpoint_path: Path, image_size=(224, 224), strict=True):
    if not checkpoint_path.exists():
        raise ValueError(f"Classifier checkpoint not found: {checkpoint_path}")

    path = Path(checkpoint_path)
    # Prefer the nested graph used by the only trained classifier on disk.
    if path.name.startswith("best_model"):
        model = build_classifier_model_from_checkpoint(image_size)
        weights = _normalize_keras3_weights(path)
        model.load_weights(str(weights))
        logger.info(f"Loaded nested classifier from {path.name}")
        return model

    model = build_classifier_model(image_size)
    try:
        model.load_weights(str(path), by_name=not strict, skip_mismatch=not strict)
        logger.info(f"Loaded classifier checkpoint: {path}")
    except Exception as e:
        if strict:
            raise ValueError(f"Failed to load classifier checkpoint: {e}") from e
        logger.warning(f"Partial classifier load: {e}")
    return model


def _load_localization_by_name(model: Model, path: Path) -> int:
    loaded = 0
    with h5py.File(path, "r") as f:
        root = f["model_weights"] if "model_weights" in f else f
        for layer in model.layers:
            expected = layer.get_weights()
            if not expected:
                continue
            key = next((k for k in (layer.name, re.sub(r"_\d+$", "", layer.name)) if k in root), None)
            if key is None:
                raise ValueError(f"Layer {layer.name} missing from {path.name}")
            grp = root[key]
            names = [n.decode() if isinstance(n, bytes) else n for n in grp.attrs["weight_names"]]
            arrays = [np.asarray(grp[n]) for n in names]
            if [a.shape for a in arrays] != [e.shape for e in expected]:
                raise ValueError(
                    f"Shape mismatch for {layer.name}: "
                    f"{[a.shape for a in arrays]} vs {[e.shape for e in expected]}"
                )
            layer.set_weights(arrays)
            loaded += 1
    return loaded


def load_localization_model(checkpoint_path: Path, image_size=(224, 224), strict=True):
    if not checkpoint_path.exists():
        raise ValueError(f"Localization checkpoint not found: {checkpoint_path}")

    path = Path(checkpoint_path)
    model = build_localization_model(image_size)

    # Keras 2 multi-head / phase checkpoints store weights by layer name.
    if path.suffix == ".h5" and ("phase" in path.name or "multihead" in path.name):
        n = _load_localization_by_name(model, path)
        logger.warning(
            f"Loaded {n} layers from multi-head/legacy checkpoint {path.name}. "
            "Mask branch only; class head ignored. Retrain a standalone localizer when possible."
        )
        return model

    try:
        model.load_weights(str(path), by_name=not strict, skip_mismatch=not strict)
        logger.info(f"Loaded localization checkpoint: {path}")
    except Exception as e:
        if strict:
            raise ValueError(f"Failed to load localization checkpoint: {e}") from e
        logger.warning(f"Partial localization load: {e}")
    return model
