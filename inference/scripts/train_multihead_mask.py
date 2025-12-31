import sys
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
import argparse
import random
from datetime import datetime
from contextlib import contextmanager

import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, Model, losses, optimizers

try:
    import tensorflow_addons as tfa
except ImportError:
    tfa = None

MIXED_PRECISION = False
try:
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        gpu_ok_for_mixed = False
        for g in gpus:
            try:
                details = tf.config.experimental.get_device_details(g)
                cc = details.get('compute_capability', None)
                if cc is not None:
                    major = cc[0] if isinstance(cc, (list, tuple)) else int(cc)
                    if major >= 7:
                        gpu_ok_for_mixed = True
            except Exception:
                pass
        
        if gpu_ok_for_mixed:
            try:
                from tensorflow.keras import mixed_precision as mp
                mp.set_global_policy('mixed_float16')
                MIXED_PRECISION = True
                print("[INFO] Mixed precision enabled (mixed_float16).")
            except Exception:
                MIXED_PRECISION = False
        else:
            try:
                from tensorflow.keras import mixed_precision as mp
                mp.set_global_policy('float32')
            except Exception:
                pass
            MIXED_PRECISION = False
    else:
        MIXED_PRECISION = False
except Exception:
    MIXED_PRECISION = False

try:
    from utils.plot_handler import plot_multihead_history
    from utils.logger import file_logging
except ImportError:
    def plot_multihead_history(history, phase_name="phase"):
        return
    
    @contextmanager
    def file_logging(log_dir=None, log_filename=None, subdirectory="logs"):
        yield None

TIMESTAMP = datetime.now().strftime('%Y%m%d')
TRAINING_LOG_FILENAME = f"training_log_mask_{TIMESTAMP}.txt"

IMAGE_SIZE = (224, 224)
BATCH_SIZE = 4
FREEZE_EPOCHS = 12
UNFREEZE_FROM_LAST_N = 20
EPOCHS_UNFREEZE = 18
LR_FREEZE = 1e-4
LR_UNFREEZE = 5e-6
TRAIN_SPLIT = 0.7
VAL_SPLIT = 0.15
TEST_SPLIT = 0.15
POS_WEIGHT = 8.0
MASK_LOSS_WEIGHT = 3.0
EARLYSTOP_PATIENCE = 5

SCRIPT_DIR = Path(__file__).parent.resolve()
INFERENCE_ROOT = SCRIPT_DIR.parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

MODEL_SAVE_DIR = INFERENCE_ROOT / "core/models/tamper_localization"
MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR = MODEL_SAVE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR = INFERENCE_ROOT / "core/models/tamper_localization/logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

DATASET_DIR = INFERENCE_ROOT / "dataset/images/tamper_localization"
CLASSIFIER_CKPT = INFERENCE_ROOT / "core/models/ai_detection/best_model_finetuned.weights.h5"

CHECKPOINT_DIR = MODEL_SAVE_DIR
BEST_PHASE1 = CHECKPOINT_DIR / "best_phase1_dice.h5"
BEST_PHASE2 = CHECKPOINT_DIR / "best_phase2_dice.h5"

with file_logging(log_dir=LOG_DIR, log_filename=TRAINING_LOG_FILENAME):
    print("="*60)
    print("GPU Detection and Configuration")
    print("="*60)
    print(f"TensorFlow version: {tf.__version__}")
    try:
        print(f"TensorFlow built with CUDA: {tf.test.is_built_with_cuda()}")
        print(f"GPU available at runtime: {tf.config.list_physical_devices('GPU') != []}")
    except Exception:
        pass
    all_devices = tf.config.list_physical_devices()
    print(f"All available devices: {[d.name for d in all_devices]}")
    print(f"Mixed precision enabled: {MIXED_PRECISION}")
    print("="*60)
    print()

    def dice_coef_from_logits(y_true, y_pred_logits, eps=1e-6):
        y_pred = tf.sigmoid(y_pred_logits)
        y_true_f = tf.reshape(y_true, [tf.shape(y_true)[0], -1])
        y_pred_f = tf.reshape(y_pred, [tf.shape(y_pred)[0], -1])
        inter = 2.0 * tf.reduce_sum(y_true_f * y_pred_f, axis=1)
        union = tf.reduce_sum(y_true_f, axis=1) + tf.reduce_sum(y_pred_f, axis=1) + eps
        return tf.reduce_mean(inter / union)

    def dice_loss_from_logits(y_true, y_pred_logits, eps=1e-6):
        return 1.0 - dice_coef_from_logits(y_true, y_pred_logits, eps)

    def iou_from_logits(y_true, y_pred_logits, eps=1e-6, threshold=0.5):
        y_pred = tf.sigmoid(y_pred_logits)
        y_pred_bin = tf.cast(y_pred > threshold, tf.float32)
        y_true_f = tf.reshape(y_true, [tf.shape(y_true)[0], -1])
        y_pred_f = tf.reshape(y_pred_bin, [tf.shape(y_pred_bin)[0], -1])
        inter = tf.reduce_sum(y_true_f * y_pred_f, axis=1)
        union = tf.reduce_sum(y_true_f + y_pred_f, axis=1) - inter
        iou = tf.where(union > 0, (inter + eps) / (union + eps), tf.ones_like(inter))
        return tf.reduce_mean(iou)

    def classifier_accuracy_from_logits(y_true, y_pred_logits, threshold=0.5):
        y_pred_prob = tf.sigmoid(y_pred_logits)
        y_pred_bin = tf.cast(y_pred_prob > threshold, tf.float32)
        y_true = tf.reshape(y_true, tf.shape(y_pred_bin))
        correct = tf.cast(tf.equal(y_true, y_pred_bin), tf.float32)
        return tf.reduce_mean(correct)

    def conv_block(x, filters, name_prefix=None):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=(None if not name_prefix else f"{name_prefix}_conv1"))(x)
        x = layers.BatchNormalization(name=(None if not name_prefix else f"{name_prefix}_bn1"))(x)
        x = layers.Activation("relu", name=(None if not name_prefix else f"{name_prefix}_act1"))(x)
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=(None if not name_prefix else f"{name_prefix}_conv2"))(x)
        x = layers.BatchNormalization(name=(None if not name_prefix else f"{name_prefix}_bn2"))(x)
        x = layers.Activation("relu", name=(None if not name_prefix else f"{name_prefix}_act2"))(x)
        return x

    def build_multihead(load_classifier_ckpt=True):
        base = tf.keras.applications.EfficientNetB0(weights="imagenet", include_top=False, input_shape=(*IMAGE_SIZE, 3))
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
            candidates = [l.output for l in all_layers if isinstance(l.output, tf.Tensor)]
            skips = candidates[-8:-4] if len(candidates) >= 8 else candidates[:4]

        bottleneck = base.output

        x = layers.GlobalAveragePooling2D(name="global_pool")(bottleneck)
        x = layers.Dropout(0.3, name="clf_dropout1")(x)
        x = layers.Dense(256, activation="relu", name="clf_dense1")(x)
        x = layers.Dropout(0.2, name="clf_dropout2")(x)
        class_logit = layers.Dense(1, activation=None, dtype="float32", name="class_logit")(x)

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

        if load_classifier_ckpt and CLASSIFIER_CKPT.exists():
            print(f"Loading classifier weights from: {CLASSIFIER_CKPT}")
            try:
                model.load_weights(str(CLASSIFIER_CKPT), by_name=True, skip_mismatch=True)
                print("Classifier weights loaded successfully.")
            except Exception as e:
                print(f"Warning: Failed to load classifier checkpoint: {e}")
        else:
            print("Warning: Classifier checkpoint not found; starting from ImageNet initialization.")

        return model

    def safe_listdir(path: Path):
        if not path.exists():
            return []
        try:
            return [p for p in path.iterdir() if p.exists()]
        except Exception:
            return []

    def load_datasets():
        edited_dir = DATASET_DIR / "edited"
        masks_dir = DATASET_DIR / "masks"
        originals_dir = DATASET_DIR / "originals"

        if not DATASET_DIR.exists():
            raise ValueError(f"Dataset directory not found: {DATASET_DIR}")

        triples = []
        for subdir in safe_listdir(edited_dir):
            if not subdir.is_dir():
                continue
            name = subdir.name
            orig_sub = originals_dir / name
            edit_sub = edited_dir / name
            mask_sub = masks_dir / name
            if not (orig_sub.exists() and edit_sub.exists() and mask_sub.exists()):
                continue
            
            edit_files = [p for p in edit_sub.iterdir() if p.suffix.lower() in ['.jpg', '.jpeg', '.png']]
            for efile in edit_files:
                fname = efile.name
                o_file = orig_sub / fname
                m_file = mask_sub / fname
                if o_file.exists() and m_file.exists():
                    triples.append((str(o_file), str(efile), str(m_file), name, fname))

        if len(triples) == 0:
            raise ValueError(
                f"No paired triples found. Expected structure:\n"
                f"  {DATASET_DIR}/\n"
                f"    edited/<subdir>/<image>.jpg\n"
                f"    masks/<subdir>/<image>.jpg\n"
                f"    originals/<subdir>/<image>.jpg"
            )

        print(f"Found {len(triples)} paired image triples.")

        random.seed(42)
        random.shuffle(triples)

        entries = []
        for orig_path, edit_path, mask_path, sub, fname in triples:
            entries.append((orig_path, None, 0.0))
            entries.append((edit_path, mask_path, 1.0))

        n_total = len(entries)
        n_train = int(n_total * TRAIN_SPLIT)
        n_val = int(n_total * VAL_SPLIT)

        train_pairs = entries[:n_train]
        val_pairs = entries[n_train:n_train + n_val]
        test_pairs = entries[n_train + n_val:]

        def load_image_tf(path):
            img_bytes = tf.io.read_file(path)
            img = tf.image.decode_image(img_bytes, channels=3, expand_animations=False)
            img = tf.image.convert_image_dtype(img, tf.float32)
            img = tf.image.resize(img, IMAGE_SIZE)
            return img
        
        def load_mask_tf(path):
            is_empty = tf.equal(tf.strings.length(path), 0)
            def _zero_mask():
                return tf.zeros((*IMAGE_SIZE, 1), dtype=tf.float32)
            def _read_mask():
                mask_bytes = tf.io.read_file(path)
                mask = tf.image.decode_image(mask_bytes, channels=1, expand_animations=False)
                mask = tf.image.convert_image_dtype(mask, tf.float32)
                mask = tf.image.resize(mask, IMAGE_SIZE, method='nearest')
                mask = tf.cast(mask > 0.5, tf.float32)
                mask_exp = tf.expand_dims(mask, axis=0)
                mask_exp = tf.nn.max_pool2d(mask_exp, ksize=3, strides=1, padding="SAME")
                mask = tf.squeeze(mask_exp, axis=0)
                return mask
            return tf.cond(is_empty, _zero_mask, _read_mask)

        def create_dataset(pairs):
            image_paths = [p[0] for p in pairs]
            mask_paths = [p[1] if p[1] is not None else '' for p in pairs]
            class_labels = [p[2] for p in pairs]

            ds = tf.data.Dataset.from_tensor_slices((image_paths, mask_paths, class_labels))

            def _process_tf(img_path, mask_path, cls):
                img = load_image_tf(img_path)
                mask = load_mask_tf(mask_path)
                img.set_shape((*IMAGE_SIZE, 3))
                mask.set_shape((*IMAGE_SIZE, 1))
                cls = tf.cast(tf.reshape(cls, (1,)), tf.float32)
                return img, (cls, mask)

            ds = ds.map(_process_tf, num_parallel_calls=tf.data.AUTOTUNE)
            return ds

        train_ds_raw = create_dataset(train_pairs)
        val_ds_raw = create_dataset(val_pairs)
        test_ds_raw = create_dataset(test_pairs)

        def augment_image_and_mask(image, mask):
            combined = tf.concat([image, mask], axis=-1)
            combined = tf.image.random_flip_left_right(combined)
            k = tf.random.uniform([], minval=0, maxval=4, dtype=tf.int32)
            combined = tf.image.rot90(combined, k)
            img_aug = combined[..., :3]
            mask_aug = combined[..., 3:]
            img_aug = tf.image.random_contrast(img_aug, lower=0.9, upper=1.1)
            img_aug = tf.clip_by_value(img_aug, 0.0, 1.0)
            return img_aug, mask_aug

        def preprocess_train(image, labels):
            class_label, mask = labels
            image, mask = augment_image_and_mask(image, mask)
            image = tf.keras.applications.efficientnet.preprocess_input(image * 255.0)
            return image, (class_label, mask)

        def preprocess_val(image, labels):
            class_label, mask = labels
            image = tf.keras.applications.efficientnet.preprocess_input(image * 255.0)
            return image, (class_label, mask)

        if CACHE_DIR.exists():
            for lockfile in CACHE_DIR.glob("*.lockfile"):
                try:
                    lockfile.unlink()
                except Exception:
                    pass
        
        print("Caching training data (this may take a while on first run)...")
        train_ds = (
            train_ds_raw
            .cache(str(CACHE_DIR / "train_cache_raw"))
            .shuffle(10000)
            .map(preprocess_train, num_parallel_calls=tf.data.AUTOTUNE)
            .batch(BATCH_SIZE)
            .prefetch(tf.data.AUTOTUNE)
        )
        print("Training data cache ready.")

        val_ds = (
            val_ds_raw
            .map(preprocess_val, num_parallel_calls=tf.data.AUTOTUNE)
            .cache(str(CACHE_DIR / "val_cache"))
            .batch(BATCH_SIZE)
            .prefetch(tf.data.AUTOTUNE)
        )

        test_ds = (
            test_ds_raw
            .map(preprocess_val, num_parallel_calls=tf.data.AUTOTUNE)
            .cache(str(CACHE_DIR / "test_cache"))
            .batch(BATCH_SIZE)
            .prefetch(tf.data.AUTOTUNE)
        )

        print(f"Train/Val/Test sizes: {len(train_pairs)}/{len(val_pairs)}/{len(test_pairs)}")
        return train_ds, val_ds, test_ds

    class MultiHeadTrainer:
        def __init__(self, model, lr=LR_FREEZE):
            self.model = model
            self.ce = losses.BinaryCrossentropy(from_logits=True)
            self.lr = lr

            base_opt = None
            try:
                if hasattr(optimizers, "AdamW"):
                    base_opt = optimizers.AdamW(learning_rate=self.lr, weight_decay=1e-5)
                    print("Using tf.keras.optimizers.AdamW")
                elif tfa is not None and hasattr(tfa.optimizers, "AdamW"):
                    base_opt = tfa.optimizers.AdamW(weight_decay=1e-5, learning_rate=self.lr)
                    print("Using tfa.optimizers.AdamW")
                else:
                    raise AttributeError
            except Exception:
                print("Warning: AdamW not available, using Adam instead")
                base_opt = optimizers.Adam(learning_rate=self.lr)

            self.opt = base_opt
            self._clip_norm = 1.0

        def set_lr(self, lr):
            try:
                if hasattr(self.opt, "learning_rate"):
                    self.opt.learning_rate = lr
                elif hasattr(self.opt, "_optimizer"):
                    self.opt._optimizer.learning_rate = lr
                self.lr = lr
            except Exception:
                pass

        def weighted_bce_from_logits(self, y_true, y_pred_logits, pos_weight=8.0):
            loss = tf.nn.weighted_cross_entropy_with_logits(
                labels=y_true, logits=y_pred_logits, pos_weight=pos_weight
            )
            return tf.reduce_mean(loss)

        def focal_dice_loss(self, y_true, y_pred_logits, gamma=0.5, eps=1e-6):
            y_pred = tf.sigmoid(y_pred_logits)
            inter = tf.reduce_sum(y_true * y_pred)
            union = tf.reduce_sum(y_true) + tf.reduce_sum(y_pred)
            dice = (2 * inter + eps) / (union + eps)
            return tf.pow(1 - dice, gamma)

        def compute_loss(self, y_true_class, y_pred_class, y_true_mask, y_pred_mask):
            class_loss = self.ce(y_true_class, y_pred_class)
            bce_mask = self.weighted_bce_from_logits(y_true_mask, y_pred_mask)
            d_loss = self.focal_dice_loss(y_true_mask, y_pred_mask)
            mask_loss = bce_mask + d_loss
            total = class_loss + MASK_LOSS_WEIGHT * mask_loss
            return total, class_loss, bce_mask, d_loss

        @tf.function
        def train_step(self, imgs, y_class, y_mask):
            with tf.GradientTape() as tape:
                class_logit, mask_logit = self.model(imgs, training=True)
                total_loss, l_class, l_bce_mask, l_dice = self.compute_loss(y_class, class_logit, y_mask, mask_logit)
            grads = tape.gradient(total_loss, self.model.trainable_variables)
            grads, _ = tf.clip_by_global_norm(grads, self._clip_norm)
            self.opt.apply_gradients(zip(grads, self.model.trainable_variables))
            return total_loss, l_class, l_bce_mask, l_dice, class_logit, mask_logit

    def freeze_classifier_head(model):
        for layer in model.layers:
            if layer.name.startswith("clf_") or layer.name == "class_logit" or layer.name == "global_pool":
                try:
                    layer.trainable = False
                except Exception:
                    pass
        print("Classifier head frozen")

    def unfreeze_classifier_head(model):
        for layer in model.layers:
            if layer.name.startswith("clf_") or layer.name == "class_logit" or layer.name == "global_pool":
                try:
                    layer.trainable = True
                except Exception:
                    pass
        print("Classifier head unfrozen")

    def unfreeze_encoder(model, last_n=UNFREEZE_FROM_LAST_N):
        eff_layers = [layer for layer in model.layers if layer.name.startswith("block") or layer.name.startswith("stem")]
        if len(eff_layers) == 0:
            cand = None
            for layer in model.layers:
                if hasattr(layer, "layers") and len(layer.layers) > 0:
                    if cand is None or len(layer.layers) > len(cand.layers):
                        cand = layer
            if cand is not None:
                eff_layers = list(cand.layers)
        if len(eff_layers) == 0:
            print("Warning: EfficientNet layers not found for unfreeze")
            return
        total = len(eff_layers)
        start_idx = max(0, total - last_n)
        for i, layer in enumerate(eff_layers):
            layer.trainable = (i >= start_idx)
        print(f"Unfroze {max(0, total - start_idx)} EfficientNet layers out of {total} (from idx {start_idx} to {total})")

    def unfreeze_for_phase2(model, last_n_backbone=40):
        for layer in model.layers:
            if layer.name.startswith("dec_") or layer.name in ["mask_logit"]:
                layer.trainable = True

        for layer in model.layers:
            if layer.name.startswith("clf_") or layer.name == "class_logit":
                layer.trainable = True

        backbone_layers = [l for l in model.layers if l.name.startswith("block") or l.name.startswith("stem")]
        total = len(backbone_layers)
        start_idx = max(0, total - last_n_backbone)
        for i, layer in enumerate(backbone_layers):
            layer.trainable = (i >= start_idx)

        print(f"Unfroze decoder + classifier + last {last_n_backbone} backbone layers")

    def evaluate_model(model, dataset, trainer=None):
        total_losses = []
        class_losses = []
        bce_mask_losses = []
        dice_losses = []
        dice_coefs = []
        ious = []
        accs = []

        for batch in dataset:
            imgs, (y_class, y_mask) = batch
            class_logit, mask_logit = model(imgs, training=False)
            if trainer is not None:
                total_loss, l_class, l_bce_mask, l_dice = trainer.compute_loss(y_class, class_logit, y_mask, mask_logit)
            else:
                l_class = losses.BinaryCrossentropy(from_logits=True)(y_class, class_logit)
                l_bce_mask = losses.BinaryCrossentropy(from_logits=True)(y_mask, mask_logit)
                l_dice = dice_loss_from_logits(y_mask, mask_logit)
                total_loss = l_class + l_bce_mask + l_dice

            total_losses.append(float(total_loss.numpy()))
            class_losses.append(float(l_class.numpy()))
            bce_mask_losses.append(float(l_bce_mask.numpy()))
            dice_losses.append(float(l_dice.numpy()))
            dice_coefs.append(float(dice_coef_from_logits(y_mask, mask_logit).numpy()))
            ious.append(float(iou_from_logits(y_mask, mask_logit).numpy()))
            accs.append(float(classifier_accuracy_from_logits(y_class, class_logit).numpy()))

        return {
            'total_loss': float(np.mean(total_losses)),
            'class_loss': float(np.mean(class_losses)),
            'bce_mask_loss': float(np.mean(bce_mask_losses)),
            'dice_loss': float(np.mean(dice_losses)),
            'dice_coef': float(np.mean(dice_coefs)),
            'iou': float(np.mean(ious)),
            'acc': float(np.mean(accs))
        }

    class DiceCheckpointEarlyStop:
        def __init__(self, filepath: Path, patience=EARLYSTOP_PATIENCE, verbose=True):
            self.filepath = Path(filepath)
            self.patience = patience
            self.verbose = verbose
            self.best = -np.inf
            self.wait = 0

        def on_epoch_end(self, epoch, val_dice, model):
            if val_dice > self.best + 1e-6:
                self.best = val_dice
                self.wait = 0
                model.save_weights(self.filepath)
                if self.verbose:
                    print(f"[Checkpoint] Epoch {epoch+1}: val_dice improved to {val_dice:.4f} — saved to {self.filepath}")
                return False
            else:
                self.wait += 1
                if self.verbose:
                    print(f"[Checkpoint] Epoch {epoch+1}: val_dice {val_dice:.4f} (best {self.best:.4f}), wait={self.wait}/{self.patience}")
                if self.wait >= self.patience:
                    if self.verbose:
                        print(f"[EarlyStopping] No improvement for {self.patience} epochs. Stopping.")
                    return True
                return False

    def train_phase1(trainer, train_ds, val_ds, test_ds):
        print("Starting Phase 1: segmentation warmup (encoder + decoder trainable, classifier frozen)")
        freeze_classifier_head(trainer.model)
        
        for layer in trainer.model.layers:
            if layer.name.startswith("block") or layer.name.startswith("stem"):
                try:
                    layer.trainable = True
                except Exception:
                    pass

        trainer.set_lr(LR_FREEZE)
        ckpt = DiceCheckpointEarlyStop(BEST_PHASE1, patience=EARLYSTOP_PATIENCE)

        history = {
            'train_total_loss': [], 'train_class_loss': [], 'train_bce_mask_loss': [], 'train_dice_loss': [],
            'train_dice_coef': [], 'val_total_loss': [], 'val_class_loss': [], 'val_bce_mask_loss': [], 
            'val_dice_loss': [], 'val_dice_coef': [], 'val_iou': [], 'val_acc': []
        }

        for epoch in range(FREEZE_EPOCHS):
            epoch_train_losses = []
            epoch_train_class = []
            epoch_train_bce = []
            epoch_train_dice = []
            epoch_train_dicecoef = []
            epoch_train_iou = []
            epoch_train_acc = []

            for imgs, (y_class, y_mask) in train_ds:
                loss, lc, lb, ld, class_logit, mask_logit = trainer.train_step(imgs, y_class, y_mask)
                epoch_train_losses.append(float(loss.numpy()))
                epoch_train_class.append(float(lc.numpy()))
                epoch_train_bce.append(float(lb.numpy()))
                epoch_train_dice.append(float(ld.numpy()))
                epoch_train_dicecoef.append(float(dice_coef_from_logits(y_mask, mask_logit).numpy()))
                epoch_train_iou.append(float(iou_from_logits(y_mask, mask_logit).numpy()))
                epoch_train_acc.append(float(classifier_accuracy_from_logits(y_class, class_logit).numpy()))

            avg_train_loss = float(np.mean(epoch_train_losses))
            avg_train_class = float(np.mean(epoch_train_class))
            avg_train_bce = float(np.mean(epoch_train_bce))
            avg_train_dice = float(np.mean(epoch_train_dice))
            avg_train_dicecoef = float(np.mean(epoch_train_dicecoef))
            avg_train_iou = float(np.mean(epoch_train_iou))
            avg_train_acc = float(np.mean(epoch_train_acc))

            val_results = evaluate_model(trainer.model, val_ds, trainer)

            history['train_total_loss'].append(avg_train_loss)
            history['train_class_loss'].append(avg_train_class)
            history['train_bce_mask_loss'].append(avg_train_bce)
            history['train_dice_loss'].append(avg_train_dice)
            history['train_dice_coef'].append(avg_train_dicecoef)
            history['val_total_loss'].append(val_results['total_loss'])
            history['val_class_loss'].append(val_results['class_loss'])
            history['val_bce_mask_loss'].append(val_results['bce_mask_loss'])
            history['val_dice_loss'].append(val_results['dice_loss'])
            history['val_dice_coef'].append(val_results['dice_coef'])
            history['val_iou'].append(val_results['iou'])
            history['val_acc'].append(val_results['acc'])

            print(f"Phase1 Epoch {epoch+1}/{FREEZE_EPOCHS} | train_loss={avg_train_loss:.4f} | train_dice_coef={avg_train_dicecoef:.4f} | val_dice={val_results['dice_coef']:.4f} | val_iou={val_results['iou']:.4f} | val_acc={val_results['acc']:.4f}")

            stop = ckpt.on_epoch_end(epoch, val_results['dice_coef'], trainer.model)
            if stop:
                print("Early stopping triggered in Phase 1")
                break

        trainer.model.save_weights(MODEL_SAVE_DIR / "multihead_phase1_frozen_last.h5")
        test_results = evaluate_model(trainer.model, test_ds, trainer)
        print(f"\nPhase 1 Test Results:")
        print(f"Test Loss: {test_results['total_loss']:.4f} | Class Loss: {test_results['class_loss']:.4f} | "
            f"BCE Mask Loss: {test_results['bce_mask_loss']:.4f} | Dice Loss: {test_results['dice_loss']:.4f} | "
            f"Dice Coef: {test_results['dice_coef']:.4f} | IoU: {test_results['iou']:.4f} | Acc: {test_results['acc']:.4f}")

        plot_multihead_history(history, phase_name="phase1")
        return history

    def train_phase2(trainer, train_ds, val_ds, test_ds):
        print("Starting Phase 2: fine-tune full model (unfreeze encoder + classifier head)")
        unfreeze_classifier_head(trainer.model)
        unfreeze_for_phase2(trainer.model, last_n_backbone=40)

        trainer.set_lr(LR_UNFREEZE)
        ckpt = DiceCheckpointEarlyStop(BEST_PHASE2, patience=EARLYSTOP_PATIENCE)

        history = {
            'train_total_loss': [], 'train_class_loss': [], 'train_bce_mask_loss': [], 'train_dice_loss': [],
            'train_dice_coef': [], 'val_total_loss': [], 'val_class_loss': [], 'val_bce_mask_loss': [], 
            'val_dice_loss': [], 'val_dice_coef': [], 'val_iou': [], 'val_acc': []
        }

        for epoch in range(EPOCHS_UNFREEZE):
            epoch_train_losses = []
            epoch_train_class = []
            epoch_train_bce = []
            epoch_train_dice = []
            epoch_train_dicecoef = []
            epoch_train_iou = []
            epoch_train_acc = []

            for imgs, (y_class, y_mask) in train_ds:
                loss, lc, lb, ld, class_logit, mask_logit = trainer.train_step(imgs, y_class, y_mask)
                epoch_train_losses.append(float(loss.numpy()))
                epoch_train_class.append(float(lc.numpy()))
                epoch_train_bce.append(float(lb.numpy()))
                epoch_train_dice.append(float(ld.numpy()))
                epoch_train_dicecoef.append(float(dice_coef_from_logits(y_mask, mask_logit).numpy()))
                epoch_train_iou.append(float(iou_from_logits(y_mask, mask_logit).numpy()))
                epoch_train_acc.append(float(classifier_accuracy_from_logits(y_class, class_logit).numpy()))

            avg_train_loss = float(np.mean(epoch_train_losses))
            avg_train_class = float(np.mean(epoch_train_class))
            avg_train_bce = float(np.mean(epoch_train_bce))
            avg_train_dice = float(np.mean(epoch_train_dice))
            avg_train_dicecoef = float(np.mean(epoch_train_dicecoef))

            val_results = evaluate_model(trainer.model, val_ds, trainer)

            history['train_total_loss'].append(avg_train_loss)
            history['train_class_loss'].append(avg_train_class)
            history['train_bce_mask_loss'].append(avg_train_bce)
            history['train_dice_loss'].append(avg_train_dice)
            history['train_dice_coef'].append(avg_train_dicecoef)
            history['val_total_loss'].append(val_results['total_loss'])
            history['val_class_loss'].append(val_results['class_loss'])
            history['val_bce_mask_loss'].append(val_results['bce_mask_loss'])
            history['val_dice_loss'].append(val_results['dice_loss'])
            history['val_dice_coef'].append(val_results['dice_coef'])
            history['val_iou'].append(val_results['iou'])
            history['val_acc'].append(val_results['acc'])

            print(f"Phase2 Epoch {epoch+1}/{EPOCHS_UNFREEZE} | train_loss={avg_train_loss:.4f} | train_dice_coef={avg_train_dicecoef:.4f} | val_dice={val_results['dice_coef']:.4f} | val_iou={val_results['iou']:.4f}")

            stop = ckpt.on_epoch_end(epoch, val_results['dice_coef'], trainer.model)
            if stop:
                print("Early stopping triggered in Phase 2")
                break

        trainer.model.save_weights(MODEL_SAVE_DIR / "multihead_phase2_finetuned_last.h5")
        test_results = evaluate_model(trainer.model, test_ds, trainer)
        print(f"\nPhase 2 Test Results:")
        print(f"Test Loss: {test_results['total_loss']:.4f} | Class Loss: {test_results['class_loss']:.4f} | "
            f"BCE Mask Loss: {test_results['bce_mask_loss']:.4f} | Dice Loss: {test_results['dice_loss']:.4f} | "
            f"Dice Coef: {test_results['dice_coef']:.4f} | IoU: {test_results['iou']:.4f} | Acc: {test_results['acc']:.4f}")

        plot_multihead_history(history, phase_name="phase2")
        return history

    def main():
        parser = argparse.ArgumentParser(description="Train multi-head tamper localization model")
        parser.add_argument("phase", choices=["1", "2"], help="Training phase: 1 (segmentation warmup) or 2 (full fine-tune)")
        args = parser.parse_args()

        train_ds, val_ds, test_ds = load_datasets()
        model = build_multihead()

        if args.phase == "2":
            if BEST_PHASE1.exists():
                print(f"Loading Phase 1 checkpoint: {BEST_PHASE1}")
                model.load_weights(str(BEST_PHASE1), by_name=True, skip_mismatch=True)
            else:
                print("Warning: Phase 1 checkpoint not found. Starting from scratch.")

        trainer = MultiHeadTrainer(model, lr=LR_FREEZE)

        if args.phase == "1":
            train_phase1(trainer, train_ds, val_ds, test_ds)
        else:
            train_phase2(trainer, train_ds, val_ds, test_ds)

        print("Training completed.")

if __name__ == "__main__":
    main()
