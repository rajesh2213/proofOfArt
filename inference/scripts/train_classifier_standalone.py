import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
import tensorflow as tf
from tensorflow.keras import layers, Sequential, Model, callbacks, optimizers, mixed_precision
from tensorflow.keras.applications import EfficientNetB0
from tensorflow.keras.applications.efficientnet import preprocess_input
from tensorflow.keras.metrics import AUC
import numpy as np
from utils.plot_handler import plot_history
from utils.logger import file_logging
from api.models import build_classifier_model

with file_logging():
    IMAGE_SIZE = (224, 224)
    BATCH_SIZE = 16
    EPOCHS_WARMUP = 15
    EPOCHS_FINETUNE = 30
    INITIAL_LR = 1e-4
    FINETUNE_LR = 5e-6
    WEIGHT_DECAY = 0.01
    DROPOUT_RATE = 0.2
    
    DATASET_DIR = Path("dataset/images/classification")
    MODEL_SAVE_DIR = Path("core/models/ai_detection")
    MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)
    
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    
    mixed_precision.set_global_policy("float32")
    
    print("=" * 80)
    print("STANDALONE CLASSIFIER TRAINING")
    print("=" * 80)
    print("\nCRITICAL: This model is trained independently from localization.")
    print("It answers: 'Is this image AI-generated?'")
    print("It does NOT provide information about localized tampering.\n")
    print("=" * 80)
    
    print("\nLoading dataset...")
    CLASS_NAMES = ['ai_generated', 'real']
    
    train_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_DIR,
        validation_split=0.2,
        subset="training",
        seed=42,
        image_size=IMAGE_SIZE,
        batch_size=None,
        label_mode="binary",
        class_names=CLASS_NAMES
    )
    
    val_test_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_DIR,
        validation_split=0.2,
        subset="validation",
        seed=42,
        image_size=IMAGE_SIZE,
        batch_size=BATCH_SIZE,
        label_mode="binary",
        class_names=CLASS_NAMES
    )
    
    val_test_cardinality = tf.data.experimental.cardinality(val_test_ds).numpy()
    test_batches = int(val_test_cardinality * 0.5)
    test_ds = val_test_ds.take(test_batches)
    val_ds = val_test_ds.skip(test_batches)
    
    data_augmentation = Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomBrightness(0.1),
        layers.RandomContrast(0.1),
        layers.RandomZoom(0.1),
        layers.RandomTranslation(0.1, 0.1),
    ])
    
    def preprocess_train(image, label):
        image = data_augmentation(image)
        image = preprocess_input(image)
        return image, label
    
    def preprocess_val_test(image, label):
        image = preprocess_input(image)
        return image, label
    
    CACHE_DIR = MODEL_SAVE_DIR / "cache"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    train_ds = (
        train_ds.cache(str(CACHE_DIR / "train_cache"))
        .shuffle(10000)
        .batch(BATCH_SIZE)
        .map(preprocess_train, num_parallel_calls=tf.data.AUTOTUNE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    val_ds = (
        val_ds.cache(str(CACHE_DIR / "val_cache"))
        .map(preprocess_val_test, num_parallel_calls=tf.data.AUTOTUNE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    test_ds = (
        test_ds.cache(str(CACHE_DIR / "test_cache"))
        .map(preprocess_val_test, num_parallel_calls=tf.data.AUTOTUNE)
        .prefetch(tf.data.AUTOTUNE)
    )
    
    print(f"Training batches: {len(train_ds)}")
    print(f"Validation batches: {len(val_ds)}")
    print(f"Test batches: {len(test_ds)}")
    
    # Build model using standalone builder
    print("\nBuilding classifier model...")
    model = build_classifier_model(IMAGE_SIZE)
    
    # Freeze backbone for warmup
    model.get_layer("efficientnetb0").trainable = False
    
    optimizer = optimizers.AdamW(
        learning_rate=INITIAL_LR,
        weight_decay=WEIGHT_DECAY
    )
    
    model.compile(
        optimizer=optimizer,
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=['accuracy', AUC(curve='ROC', name='auc')]
    )
    
    print(f"Model parameters: {model.count_params():,}")
    print(f"Trainable parameters: {sum([tf.size(w).numpy() for w in model.trainable_weights]):,}")
    
    callbacks_list = [
        callbacks.ModelCheckpoint(
            filepath=str(MODEL_SAVE_DIR / "best_classifier_warmup.weights.h5"),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
            save_weights_only=True,
            verbose=1
        ),
        callbacks.EarlyStopping(
            monitor="val_loss",
            mode="min",
            patience=10,
            restore_best_weights=True,
            verbose=1
        ),
        callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            min_lr=1e-7,
            verbose=1
        )
    ]
    
    print("\n" + "=" * 80)
    print("PHASE 1: Warmup (frozen backbone)")
    print("=" * 80)
    
    model.summary()
    
    history_warmup = model.fit(
        train_ds,
        validation_data=val_ds,
        callbacks=callbacks_list,
        epochs=EPOCHS_WARMUP,
        verbose=1
    )
    
    print("\n" + "=" * 80)
    print("PHASE 2: Finetuning (unfrozen backbone)")
    print("=" * 80)
    
    model.get_layer("efficientnetb0").trainable = True
    
    optimizer_finetune = optimizers.AdamW(
        learning_rate=FINETUNE_LR,
        weight_decay=WEIGHT_DECAY
    )
    
    model.compile(
        optimizer=optimizer_finetune,
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=['accuracy', AUC(curve='ROC', name='auc')]
    )
    
    callbacks_finetune = [
        callbacks.ModelCheckpoint(
            filepath=str(MODEL_SAVE_DIR / "best_classifier_finetuned.weights.h5"),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
            save_weights_only=True,
            verbose=1
        ),
        callbacks.EarlyStopping(
            monitor="val_loss",
            mode="min",
            patience=10,
            restore_best_weights=True,
            verbose=1
        ),
        callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            min_lr=1e-7,
            verbose=1
        )
    ]
    
    history_finetune = model.fit(
        train_ds,
        validation_data=val_ds,
        callbacks=callbacks_finetune,
        epochs=EPOCHS_FINETUNE,
        verbose=1
    )
    
    print("\n" + "=" * 80)
    print("TEST SET EVALUATION")
    print("=" * 80)
    
    test_results = model.evaluate(test_ds, verbose=1)
    print(f"Test Loss: {test_results[0]:.4f}")
    print(f"Test Accuracy: {test_results[1]:.4f}")
    print(f"Test AUC: {test_results[2]:.4f}")
    
    print("\nPlotting training history...")
    plot_history(history_warmup)
    plot_history(history_finetune)
    
    print("\n" + "=" * 80)
    print("TRAINING COMPLETE")
    print("=" * 80)
    print(f"Best model saved to: {MODEL_SAVE_DIR / 'best_classifier_finetuned.weights.h5'}")

