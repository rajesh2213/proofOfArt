import sys
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
import random
from datetime import datetime
from contextlib import contextmanager

import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, Model, callbacks, optimizers

try:
    from utils.plot_handler import plot_multihead_history
    from utils.logger import file_logging
except ImportError:
    def plot_multihead_history(history, phase_name="phase"):
        return
    
    @contextmanager
    def file_logging(log_dir=None, log_filename=None, subdirectory="logs"):
        yield None

from api.models import build_localization_model

TIMESTAMP = datetime.now().strftime('%Y%m%d')
TRAINING_LOG_FILENAME = f"training_log_localization_{TIMESTAMP}.txt"

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
EARLYSTOP_PATIENCE = 5

SCRIPT_DIR = Path(__file__).parent.resolve()
INFERENCE_ROOT = SCRIPT_DIR.parent

MODEL_SAVE_DIR = INFERENCE_ROOT / "core/models/tamper_localization"
MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR = MODEL_SAVE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR = INFERENCE_ROOT / "core/models/tamper_localization/logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

DATASET_DIR = INFERENCE_ROOT / "dataset/images/tamper_localization"

CHECKPOINT_DIR = MODEL_SAVE_DIR

with file_logging(log_dir=str(LOG_DIR), log_filename=TRAINING_LOG_FILENAME):
    print("=" * 80)
    print("STANDALONE LOCALIZATION MODEL TRAINING")
    print("=" * 80)
    print("\nCRITICAL: This model is trained independently from classification.")
    print("It answers: 'Where in the image is localized tampering?'")
    print("It does NOT provide information about AI generation.")
    print("The presence of tampering does NOT imply AI generation.\n")
    print("=" * 80)
    
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
        
        if not DATASET_DIR.exists():
            raise ValueError(f"Dataset directory not found: {DATASET_DIR}")
        
        pairs = []
        for subdir in safe_listdir(edited_dir):
            if not subdir.is_dir():
                continue
            name = subdir.name
            edit_sub = edited_dir / name
            mask_sub = masks_dir / name
            
            if not (edit_sub.exists() and mask_sub.exists()):
                continue
            
            edit_files = [p for p in edit_sub.iterdir() 
                         if p.suffix.lower() in ['.jpg', '.jpeg', '.png']]
            for efile in edit_files:
                fname = efile.name
                m_file = mask_sub / fname
                if m_file.exists():
                    pairs.append((str(efile), str(m_file), name, fname))
        
        if len(pairs) == 0:
            raise ValueError(
                f"No paired (edited, mask) pairs found. Expected structure:\n"
                f"  {DATASET_DIR}/\n"
                f"    edited/<subdir>/<image>.jpg\n"
                f"    masks/<subdir>/<image>.jpg"
            )
        
        print(f"Found {len(pairs)} edited image + mask pairs.")
        
        random.seed(42)
        random.shuffle(pairs)
        
        n_total = len(pairs)
        n_train = int(n_total * TRAIN_SPLIT)
        n_val = int(n_total * VAL_SPLIT)
        
        train_pairs = pairs[:n_train]
        val_pairs = pairs[n_train:n_train + n_val]
        test_pairs = pairs[n_train + n_val:]
        
        print(f"Train: {len(train_pairs)}, Val: {len(val_pairs)}, Test: {len(test_pairs)}")
        
        def load_image_tf(path):
            img_bytes = tf.io.read_file(path)
            img = tf.image.decode_image(img_bytes, channels=3, expand_animations=False)
            img = tf.image.convert_image_dtype(img, tf.float32)
            img = tf.image.resize(img, IMAGE_SIZE)
            img = tf.keras.applications.efficientnet.preprocess_input(img * 255.0) / 255.0
            return img
        
        def load_mask_tf(path):
            mask_bytes = tf.io.read_file(path)
            mask = tf.image.decode_image(mask_bytes, channels=1, expand_animations=False)
            mask = tf.image.convert_image_dtype(mask, tf.float32)
            mask = tf.image.resize(mask, IMAGE_SIZE, method='nearest')
            mask = tf.cast(mask > 0.5, tf.float32)
            return mask
        
        def create_dataset(pairs):
            image_paths = [p[0] for p in pairs]
            mask_paths = [p[1] for p in pairs]
            
            ds = tf.data.Dataset.from_tensor_slices((image_paths, mask_paths))
            
            def _process_tf(img_path, mask_path):
                img = load_image_tf(img_path)
                mask = load_mask_tf(mask_path)
                img.set_shape((*IMAGE_SIZE, 3))
                mask.set_shape((*IMAGE_SIZE, 1))
                return img, mask
            
            ds = ds.map(_process_tf, num_parallel_calls=tf.data.AUTOTUNE)
            return ds
        
        train_ds_raw = create_dataset(train_pairs)
        val_ds_raw = create_dataset(val_pairs)
        test_ds_raw = create_dataset(test_pairs)
        
        return train_ds_raw, val_ds_raw, test_ds_raw
    
    def weighted_bce_from_logits(y_true, y_pred_logits, pos_weight=POS_WEIGHT):
        loss = tf.nn.weighted_cross_entropy_with_logits(
            labels=y_true,
            logits=y_pred_logits,
            pos_weight=pos_weight
        )
        return tf.reduce_mean(loss)
    
    def focal_dice_loss(y_true, y_pred_logits, gamma=0.5, eps=1e-6):
        y_pred = tf.sigmoid(y_pred_logits)
        inter = tf.reduce_sum(y_true * y_pred)
        union = tf.reduce_sum(y_true) + tf.reduce_sum(y_pred)
        dice = (2 * inter + eps) / (union + eps)
        return tf.pow(1 - dice, gamma)
    
    def compute_loss(y_true_mask, y_pred_mask_logits):
        bce_mask = weighted_bce_from_logits(y_true_mask, y_pred_mask_logits)
        d_loss = focal_dice_loss(y_true_mask, y_pred_mask_logits)
        total_loss = bce_mask + d_loss
        return total_loss, bce_mask, d_loss
    
    print("\nLoading datasets...")
    train_ds_raw, val_ds_raw, test_ds_raw = load_datasets()
    
    train_ds = (
        train_ds_raw
        .cache(str(CACHE_DIR / "train_cache"))
        .shuffle(10000)
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    val_ds = (
        val_ds_raw
        .cache(str(CACHE_DIR / "val_cache"))
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    test_ds = (
        test_ds_raw
        .cache(str(CACHE_DIR / "test_cache"))
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    print("\nBuilding localization model...")
    model = build_localization_model(IMAGE_SIZE)
    
    model.get_layer("efficientnetb0").trainable = False
    
    optimizer = optimizers.AdamW(learning_rate=LR_FREEZE, weight_decay=0.01)
    
    @tf.function
    def train_step(imgs, y_mask):
        with tf.GradientTape() as tape:
            mask_logit = model(imgs, training=True)
            total_loss, l_bce, l_dice = compute_loss(y_mask, mask_logit)
        grads = tape.gradient(total_loss, model.trainable_variables)
        grads, _ = tf.clip_by_global_norm(grads, 1.0)
        optimizer.apply_gradients(zip(grads, model.trainable_variables))
        return total_loss, l_bce, l_dice, mask_logit
    
    def dice_coefficient(y_true, y_pred_logits, eps=1e-6):
        y_pred = tf.sigmoid(y_pred_logits)
        inter = tf.reduce_sum(y_true * y_pred)
        union = tf.reduce_sum(y_true) + tf.reduce_sum(y_pred)
        return (2 * inter + eps) / (union + eps)
    
    print(f"Model parameters: {model.count_params():,}")
    print(f"Trainable parameters: {sum([tf.size(w).numpy() for w in model.trainable_weights]):,}")
    
    print("\n" + "=" * 80)
    print("PHASE 1: Training with frozen backbone")
    print("=" * 80)
    
    best_val_dice = 0.0
    patience_counter = 0
    
    for epoch in range(FREEZE_EPOCHS):
        epoch_losses = []
        epoch_bce = []
        epoch_dice = []
        
        for batch_imgs, batch_masks in train_ds:
            loss, bce, dice, _ = train_step(batch_imgs, batch_masks)
            epoch_losses.append(loss.numpy())
            epoch_bce.append(bce.numpy())
            epoch_dice.append(dice.numpy())
        
        val_dices = []
        for val_imgs, val_masks in val_ds:
            val_mask_logit = model(val_imgs, training=False)
            val_dice = dice_coefficient(val_masks, val_mask_logit)
            val_dices.append(val_dice.numpy())
        
        avg_val_dice = np.mean(val_dices)
        avg_loss = np.mean(epoch_losses)
        
        print(f"Epoch {epoch+1}/{FREEZE_EPOCHS} - Loss: {avg_loss:.4f}, Val Dice: {avg_val_dice:.4f}")
        
        if avg_val_dice > best_val_dice:
            best_val_dice = avg_val_dice
            model.save_weights(str(MODEL_SAVE_DIR / "best_localization_phase1.weights.h5"))
            patience_counter = 0
        else:
            patience_counter += 1
        
        if patience_counter >= EARLYSTOP_PATIENCE:
            print(f"Early stopping at epoch {epoch+1}")
            break
    
    print("\n" + "=" * 80)
    print("PHASE 2: Finetuning with unfrozen backbone")
    print("=" * 80)
    
    model.get_layer("efficientnetb0").trainable = True
    for layer in model.get_layer("efficientnetb0").layers[:-UNFREEZE_FROM_LAST_N]:
        layer.trainable = False
    
    optimizer = optimizers.AdamW(learning_rate=LR_UNFREEZE, weight_decay=0.01)
    
    best_val_dice = 0.0
    patience_counter = 0
    
    for epoch in range(EPOCHS_UNFREEZE):
        epoch_losses = []
        
        for batch_imgs, batch_masks in train_ds:
            loss, _, _, _ = train_step(batch_imgs, batch_masks)
            epoch_losses.append(loss.numpy())
        
        val_dices = []
        for val_imgs, val_masks in val_ds:
            val_mask_logit = model(val_imgs, training=False)
            val_dice = dice_coefficient(val_masks, val_mask_logit)
            val_dices.append(val_dice.numpy())
        
        avg_val_dice = np.mean(val_dices)
        avg_loss = np.mean(epoch_losses)
        
        print(f"Epoch {epoch+1}/{EPOCHS_UNFREEZE} - Loss: {avg_loss:.4f}, Val Dice: {avg_val_dice:.4f}")
        
        if avg_val_dice > best_val_dice:
            best_val_dice = avg_val_dice
            model.save_weights(str(MODEL_SAVE_DIR / "best_localization_phase2.weights.h5"))
            patience_counter = 0
        else:
            patience_counter += 1
        
        if patience_counter >= EARLYSTOP_PATIENCE:
            print(f"Early stopping at epoch {epoch+1}")
            break
    
    print("\n" + "=" * 80)
    print("TEST SET EVALUATION")
    print("=" * 80)
    
    test_dices = []
    test_ious = []
    
    for test_imgs, test_masks in test_ds:
        test_mask_logit = model(test_imgs, training=False)
        test_mask_pred = tf.sigmoid(test_mask_logit) > 0.5
        
        dice = dice_coefficient(test_masks, test_mask_logit)
        test_dices.append(dice.numpy())
        
        intersection = tf.reduce_sum(test_masks * test_mask_pred)
        union = tf.reduce_sum(test_masks) + tf.reduce_sum(test_mask_pred) - intersection
        iou = intersection / (union + 1e-6)
        test_ious.append(iou.numpy())
    
    print(f"Test Dice: {np.mean(test_dices):.4f}")
    print(f"Test IoU: {np.mean(test_ious):.4f}")
    
    print("\n" + "=" * 80)
    print("TRAINING COMPLETE")
    print("=" * 80)
    print(f"Best model saved to: {MODEL_SAVE_DIR / 'best_localization_phase2.weights.h5'}")

