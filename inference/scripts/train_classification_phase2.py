import sys, os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
from pathlib import Path
import tensorflow as tf
from tensorflow.keras import layers, Sequential, Model, callbacks, optimizers, mixed_precision
from tensorflow.keras.applications import EfficientNetB0
from tensorflow.keras.applications.efficientnet import preprocess_input
from tensorflow.keras.metrics import AUC
import matplotlib.pyplot as plt
import numpy as np
from utils.plot_handler import plot_history
from utils.logger import file_logging
from datetime import datetime

TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')
TRAINING_LOG_FILENAME = f"training_log_phase2_{TIMESTAMP}.txt"

with file_logging(log_filename=TRAINING_LOG_FILENAME):
    IMAGE_SIZE = (224, 224)
    BATCH_SIZE = 16
    EPOCHS_FINETUNE = 30
    FINETUNE_LR = 1e-5  
    WEIGHT_DECAY = 1e-6

    DATASET_DIR = "dataset/images/classification"
    MODEL_SAVE_DIR = Path("core/models/ai_detection")
    CACHE_DIR = MODEL_SAVE_DIR / "cache"
    MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)

    print("\n" + "=" * 60)
    print("🚀 Starting Phase 2 — Fine-tuning pretrained backbone")
    print("=" * 60)

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
        batch_size=None,
        label_mode="binary",
        class_names=CLASS_NAMES
    )

    val_test_cardinality = tf.data.experimental.cardinality(val_test_ds).numpy()
    test_size = int(val_test_cardinality * 0.5)
    test_ds = val_test_ds.take(test_size)
    val_ds = val_test_ds.skip(test_size)

    data_augmentation = Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomBrightness(0.1),
        layers.RandomContrast(0.1),
        layers.RandomZoom(0.1)
    ])

    def preprocess_train(image, label):
        image = data_augmentation(image)
        image = preprocess_input(image)
        return image, label 

    def preprocess_val_test(image, label):
        image = preprocess_input(image)
        return image, label

    train_ds = (
        train_ds.cache(str(CACHE_DIR / "train_p2_cache"))
        .shuffle(10000)
        .map(preprocess_train, num_parallel_calls=tf.data.AUTOTUNE)
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )

    val_ds = (
        val_ds.cache(str(CACHE_DIR / "val_p2_cache"))
        .map(preprocess_val_test, num_parallel_calls=tf.data.AUTOTUNE)
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )

    test_ds = (
        test_ds.cache(str(CACHE_DIR / "test_p2_cache"))
        .map(preprocess_val_test,num_parallel_calls=tf.data.AUTOTUNE)
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )

    print(f"Training batches: {len(train_ds)}")
    print(f"Validation batches: {len(val_ds)}")
    print(f"Test batches: {len(test_ds)}")

    print("\n" + "=" * 60)
    print("Loading Phase 1 model and unfreezing layers...")
    print("=" * 60)

    base_model = EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*IMAGE_SIZE, 3)
    )

    UNFREEZE_FROM_LAYER = len(base_model.layers) - 140

    inputs = layers.Input(shape=(*IMAGE_SIZE, 3))
    x = base_model(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(1, dtype="float32")(x)

    model = Model(inputs, outputs)

    phase1_weights = MODEL_SAVE_DIR / "best_model.weights.h5"

    if phase1_weights.exists():
        print(f"Loading Phase 1 weights from: {phase1_weights}")
        model.load_weights(str(phase1_weights))
    else:
        print("WARNING: No Phase 1 weights found! Starting from scratch.")
        print("Make sure you run Phase 1 training first!")

    base_model.trainable = True

    frozen_count = 0
    trainable_count = 0

    for i, layer in enumerate(base_model.layers):
        if i < UNFREEZE_FROM_LAYER:
            layer.trainable = False
            frozen_count += 1
        else:
            layer.trainable = True
            trainable_count += 1

    print(f"\nEfficientNetB0 has {len(base_model.layers)} layers")
    print(f"Frozen layers: {frozen_count}")
    print(f"Trainable layers: {trainable_count}")
    print(f"Total trainable parameters: {sum([tf.size(w).numpy() for w in model.trainable_weights]):,}")
    print(f"\nUnfreezing from layer index: {UNFREEZE_FROM_LAYER}")
    print(f"Layer name at index {UNFREEZE_FROM_LAYER}: {base_model.layers[UNFREEZE_FROM_LAYER].name}")


    optimizer = optimizers.AdamW(
        learning_rate=FINETUNE_LR,
        weight_decay=WEIGHT_DECAY
    )
    
    model.compile(
        optimizer=optimizer,
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=['accuracy', AUC(curve='ROC', name='auc')]
    )

    print("\n" + "=" * 60)
    print("Setting up fine-tuning callbacks...")
    print("=" * 60)

    callbacks_list = [
        callbacks.ModelCheckpoint(
            filepath=str(MODEL_SAVE_DIR / "best_model_finetuned.weights.h5"),
            monitor="val_auc",
            mode="max",
            save_best_only=True,
            save_weights_only=True,
            verbose=1
        ),
        callbacks.EarlyStopping(
            monitor="val_auc",
            mode="max",
            patience=8,
            restore_best_weights=True,
            verbose=1
        ),
        callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=4,
            min_lr=1e-7,
            verbose=1
        ),
        callbacks.CSVLogger(
            str(MODEL_SAVE_DIR / "training_log_phase2.csv"),
            append=True,
        )
    ]

    print("\n" + "=" * 60)
    print("Starting Phase 2 fine-tuning...")
    print(f"Learning rate: {FINETUNE_LR}")
    print(f"Epochs: {EPOCHS_FINETUNE}")
    print("=" * 60)

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        callbacks=callbacks_list,
        epochs=EPOCHS_FINETUNE,
        verbose=1
    )

    print("\n" + "=" * 60)
    print("Evaluating on test set...")
    print("=" * 60)

    test_results = model.evaluate(test_ds, verbose=1)

    print(f"\nTest Loss: {test_results[0]:.4f}")
    print(f"Test Accuracy: {test_results[1]:.4f}")
    print(f"Test AUC: {test_results[2]:.4f}")

    final_model_path = MODEL_SAVE_DIR / "final_model_phase2.weights.h5"
    model.save_weights(str(final_model_path))
    print(f"\nFinal model saved to: {final_model_path}")

    print("\n" + "=" * 60)
    print("Plotting training history...")
    print("=" * 60)

    plot_history(history)

    summary = {
        "phase": 2,
        "epochs_trained": len(history.history['loss']),
        "final_train_accuracy": float(history.history['accuracy'][-1]),
        "final_val_accuracy": float(history.history['val_accuracy'][-1]),
        "final_train_auc": float(history.history['auc'][-1]),
        "final_val_auc": float(history.history['val_auc'][-1]),
        "best_val_auc": float(max(history.history['val_auc'])),
        "test_accuracy": float(test_results[1]),
        "test_auc": float(test_results[2]),
        "frozen_layers_count": frozen_count,
        "trainable_layers_count": trainable_count,
        "unfreeze_from_layer_index": UNFREEZE_FROM_LAYER,
        "learning_rate": FINETUNE_LR,
        "weight_decay": WEIGHT_DECAY,
    }

    summary_path = MODEL_SAVE_DIR / "training_summary_phase2.json"
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"\nTraining summary saved to: {summary_path}")
    print("\n" + "=" * 60)
    print("Phase 2 Complete!")
    print("=" * 60)
    print(f"Best Val AUC: {summary['best_val_auc']:.4f}")
    print(f"Test AUC: {summary['test_auc']:.4f}")
