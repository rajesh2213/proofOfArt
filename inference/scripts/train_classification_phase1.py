import sys, os
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

with file_logging():
    TRAIN_SPLIT_PERCENT = 0.6
    VAL_TEST_SPLIT = 0.2
    IMAGE_SIZE = (224, 224)
    BATCH_SIZE = 16
    EPOCHS = 50
    EPOCHS_WARMUP = 15
    EPOCHS_FINETUNE = 30
    INITIAL_LR = 1e-4
    WEIGHT_DECAY = 0.01
    WARMUP_STEPS = 1000
    DROPOUT_RATE = 0.2

    DATASET_DIR = "dataset/images/classification"
    MODEL_SAVE_DIR = Path("core/models/ai_detection")
    MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)

    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)

    mixed_precision.set_global_policy("float32")

    print("=" * 60)
    print("Loading and preparing datasets...")
    print("=" * 60)

    CLASS_NAMES = ['ai_generated', 'real']

    train_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_DIR,
        validation_split=VAL_TEST_SPLIT,
        subset="training",
        seed=42,
        image_size=IMAGE_SIZE,
        batch_size=None,
       # batch_size=BATCH_SIZE,
        label_mode="binary",
        class_names=CLASS_NAMES 
    )

    val_test_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_DIR,
        validation_split=VAL_TEST_SPLIT,
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

    normalization_layer = layers.Rescaling(1.0 / 255.0)

    data_augmentation = Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomBrightness(0.1),
        layers.RandomContrast(0.1),
        layers.RandomZoom(0.1),
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


    print("\n" + "=" * 60)
    print("LABEL VERIFICATION")
    print("=" * 60)

    for images, labels in train_ds.take(1):
        print(f"First 10 labels: {labels.numpy()[:10]}")
        print(f"Label dtype: {labels.dtype}")
        print(f"Label range: [{labels.numpy().min()}, {labels.numpy().max()}]")
        print(f"Unique labels: {np.unique(labels.numpy())}")
        
    all_labels = []
    for _, labels in train_ds.unbatch().batch(1000).take(10):
        all_labels.extend(labels.numpy())
    print(f"Class distribution: 0={sum(1 for l in all_labels if l==0)}, 1={sum(1 for l in all_labels if l==1)}")
    print("=" * 60)

    print(f"Training batches: {len(train_ds)}")
    print(f"Validation batches: {len(val_ds)}")
    print(f"Test batches: {len(test_ds)}")

    print("\n" + "=" * 60)
    print("Building model architecture...")
    print("=" * 60)

    base_model = EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*IMAGE_SIZE, 3),
    )

    base_model.trainable = False

    inputs = layers.Input(shape=(*IMAGE_SIZE, 3))
    x = base_model(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(1, dtype="float32")(x)

    model = Model(inputs, outputs)

    print(f"Model parameters: {model.count_params():,}")
    print(f"Trainable parameters: {sum([tf.size(w).numpy() for w in model.trainable_weights]):,}")

    optimizer = optimizers.AdamW(
        learning_rate=INITIAL_LR,
        weight_decay=WEIGHT_DECAY
    )

    model.compile(
        optimizer=optimizer,
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=['accuracy', AUC(curve='ROC', name='auc')]
    )

    print("\n" + "=" * 60)
    print("Setting up training callbacks...")
    print("=" * 60)

    model.summary()

    callbacks_list = [
        callbacks.ModelCheckpoint(
            filepath=str(MODEL_SAVE_DIR / "best_model.weights.h5"),
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

    print("\n" + "=" * 60)
    print("Starting training...")
    print("=" * 60)

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        callbacks=callbacks_list,
        epochs=EPOCHS_WARMUP,
        verbose=1
    )

    print("\n" + "=" * 60)
    print("Plotting training history...")
    print("=" * 60)

    plot_history(history)
