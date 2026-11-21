"""Frozen EfficientNetB0 baseline, preprocessed exactly like api/routes/analyze.py."""
import os
import random
import re
import tempfile
from pathlib import Path
from typing import List, Optional, Set

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import h5py
import numpy as np
from PIL import Image

from eval.adapters.base import ClassifierAdapter, DecisionConfig, LocalizerAdapter, ModelInfo, file_sha256
from eval.config import CLASSIFICATION_DIR, INFERENCE_ROOT, TAMPER_DIR

IMAGE_SIZE = 224
CLASSIFIER_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_model_finetuned.weights.h5"
LOCALIZER_CKPT = INFERENCE_ROOT / "core/models/tamper_localization/best_phase2_dice.h5"

API_DECISION = DecisionConfig(
    ai_threshold=0.6,
    mask_threshold=0.5,
    min_edited_area_ratio=0.001,
    min_mask_pixels=10,
    morph_closing=3,
)


def api_preprocess(images: List[Image.Image]) -> np.ndarray:
    batch = [
        np.asarray(img.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.BILINEAR), dtype=np.float32)
        for img in images
    ]
    # efficientnet.preprocess_input is the identity; the network rescales internally.
    return np.stack(batch)


def _rel(path: Path) -> str:
    return path.resolve().relative_to(INFERENCE_ROOT).as_posix()


def _normalized_keras3_weights(src: Path, sha: str) -> Path:
    """Keras 3 on Windows wrote group paths with backslashes; rewrite as nested groups."""
    dst = Path(tempfile.gettempdir()) / f"poa_eval_{sha[:16]}.weights.h5"
    if dst.exists():
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


class BaselineB0Classifier(ClassifierAdapter):
    decision = API_DECISION

    def __init__(self):
        from keras import Model, layers
        from keras.applications import EfficientNetB0

        self.sha = file_sha256(CLASSIFIER_CKPT)
        # Mirrors the graph that produced the checkpoint (scripts/test_classification.py),
        # not api/models.build_classifier_model, whose flattened layout cannot load it.
        inputs = layers.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3))
        base = EfficientNetB0(weights=None, include_top=False, input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3))
        x = base(inputs, training=False)
        x = layers.GlobalAveragePooling2D()(x)
        x = layers.Dropout(0.3)(x)
        x = layers.Dense(256, activation="relu")(x)
        x = layers.Dropout(0.2)(x)
        outputs = layers.Dense(1, dtype="float32")(x)
        self.model = Model(inputs, outputs)
        self.model.load_weights(str(_normalized_keras3_weights(CLASSIFIER_CKPT, self.sha)))

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="baseline_b0",
            architecture="EfficientNetB0 (nested) + GAP + Dense256 + logit, RGB 224px",
            checkpoint=_rel(CLASSIFIER_CKPT),
            checkpoint_sha256=self.sha,
            input_size=IMAGE_SIZE,
            notes=[
                "api/routes/analyze.py points at best_classifier_finetuned.weights.h5, which does not exist; "
                "this is the only trained classifier on disk.",
                "The logit encodes P(real) (Keras label 1 = 'real'); analyze.py reads it as P(AI), which inverts "
                "every production verdict. This adapter reports 1 - sigmoid(logit).",
                "seen_paths reconstructs the Keras 80/20 seed-42 split from today's directory listing.",
            ],
        )

    def predict_proba(self, images: List[Image.Image]) -> np.ndarray:
        logits = self.model.predict(api_preprocess(images), verbose=0).reshape(-1)
        # Trained with class_names=['ai_generated', 'real'], so the logit is P(real).
        return 1.0 - 1.0 / (1.0 + np.exp(-logits))

    def seen_paths(self) -> Optional[Set[str]]:
        import keras

        # The 20% validation subset drove checkpoint selection, so only the
        # training subset counts as seen. Val/test are nominally unseen.
        ds = keras.utils.image_dataset_from_directory(
            str(CLASSIFICATION_DIR),
            validation_split=0.2,
            subset="training",
            seed=42,
            image_size=(IMAGE_SIZE, IMAGE_SIZE),
            batch_size=None,
            label_mode="binary",
            class_names=["ai_generated", "real"],
            verbose=False,
        )
        return {_rel(Path(p)) for p in ds.file_paths}


class BaselineB0Localizer(LocalizerAdapter):
    decision = API_DECISION

    def __init__(self):
        from api.models import build_localization_model

        self.sha = file_sha256(LOCALIZER_CKPT)
        self.model = build_localization_model((IMAGE_SIZE, IMAGE_SIZE))
        self.loaded_layers = self._load_by_name(LOCALIZER_CKPT)

    def _load_by_name(self, path: Path) -> int:
        """Load the mask branch of the Keras 2.10 multi-head checkpoint.

        Fails loudly if any weight-bearing layer is missing or mis-shaped;
        the checkpoint's class head (clf_*, class_logit) is intentionally unused.
        """
        loaded = 0
        with h5py.File(path, "r") as f:
            root = f["model_weights"] if "model_weights" in f else f
            for layer in self.model.layers:
                expected = layer.get_weights()
                if not expected:
                    continue
                # Auto-named layers get a _N suffix when another model was built first in-process.
                key = next((k for k in (layer.name, re.sub(r"_\d+$", "", layer.name)) if k in root), None)
                if key is None:
                    raise ValueError(f"Layer {layer.name} missing from {path.name}")
                grp = root[key]
                names = [n.decode() if isinstance(n, bytes) else n for n in grp.attrs["weight_names"]]
                arrays = [np.asarray(grp[n]) for n in names]
                if [a.shape for a in arrays] != [e.shape for e in expected]:
                    raise ValueError(f"Shape mismatch for {layer.name}: "
                                     f"{[a.shape for a in arrays]} vs {[e.shape for e in expected]}")
                layer.set_weights(arrays)
                loaded += 1
        return loaded

    def info(self) -> ModelInfo:
        return ModelInfo(
            name="baseline_b0_multihead_mask",
            architecture="EfficientNetB0 + U-Net decoder (mask branch of multi-head model), RGB 224px",
            checkpoint=_rel(LOCALIZER_CKPT),
            checkpoint_sha256=self.sha,
            input_size=IMAGE_SIZE,
            notes=[
                f"Loaded {self.loaded_layers} weight layers by name; class head ignored.",
                "ARCHITECTURE.md marks this multi-head checkpoint invalid for production, but no standalone "
                "localizer checkpoint exists (best_localization_phase2.weights.h5 is missing).",
                "seen_paths reconstructs scripts/train_multihead_mask.py's seed-42 shuffle (train+val).",
            ],
        )

    def predict_prob_maps(self, images: List[Image.Image]) -> List[np.ndarray]:
        logits = self.model.predict(api_preprocess(images), verbose=0)
        probs = 1.0 / (1.0 + np.exp(-logits[..., 0]))
        return list(probs)

    def seen_paths(self) -> Optional[Set[str]]:
        # NTFS enumerates case-insensitively, which is what iterdir() saw at training time.
        def ordered(folder: Path):
            return sorted(folder.iterdir(), key=lambda p: p.name.upper())

        edited_dir, masks_dir, orig_dir = TAMPER_DIR / "edited", TAMPER_DIR / "masks", TAMPER_DIR / "originals"
        triples = []
        for sub in ordered(edited_dir):
            if not sub.is_dir():
                continue
            o_sub, m_sub = orig_dir / sub.name, masks_dir / sub.name
            if not (o_sub.exists() and m_sub.exists()):
                continue
            for efile in ordered(sub):
                if efile.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                    continue
                o_file, m_file = o_sub / efile.name, m_sub / efile.name
                if o_file.exists() and m_file.exists():
                    triples.append((o_file, efile))
        random.seed(42)
        random.shuffle(triples)
        entries = []
        for orig, edit in triples:
            entries.extend([orig, edit])
        n_seen = int(len(entries) * 0.7) + int(len(entries) * 0.15)
        return {_rel(p) for p in entries[:n_seen]}
