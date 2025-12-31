import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pathlib import Path
import tensorflow as tf
from tensorflow.keras import layers, Model
from tensorflow.keras.applications import EfficientNetB0
from tensorflow.keras.applications.efficientnet import preprocess_input
from tensorflow.keras.metrics import AUC
import json
from utils.logger import file_logging
from datetime import datetime


TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')
TEST_LOG_FILENAME = f"testing_log_{TIMESTAMP}.txt"

with file_logging(log_filename=TEST_LOG_FILENAME):
    IMAGE_SIZE = (224, 224)
    BATCH_SIZE = 16
    DATASET_DIR = "dataset/images/classification"
    MODEL_SAVE_DIR = Path("core/models/ai_detection")
    CACHE_DIR = MODEL_SAVE_DIR / "cache"

    CLASS_NAMES = ['ai_generated', 'real']

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


    def preprocess_val_test(image, label):
        image = preprocess_input(image)
        return image, label

    test_ds = (
        test_ds.cache(str(CACHE_DIR / "test_p2_cache"))
        .map(preprocess_val_test, num_parallel_calls=tf.data.AUTOTUNE)
        .batch(BATCH_SIZE)
        .prefetch(tf.data.AUTOTUNE)
    )

    base_model = EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(*IMAGE_SIZE, 3)
    )

    inputs = layers.Input(shape=(*IMAGE_SIZE, 3))
    x = base_model(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(1, dtype="float32")(x)

    model = Model(inputs, outputs)

    model.load_weights(str(MODEL_SAVE_DIR / "best_model_finetuned.weights.h5"))

    model.compile(
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        metrics=['accuracy', AUC(curve='ROC', name='auc')]
    )

    print("\n" + "=" * 60)
    print("Evaluating on test set...")
    print("=" * 60)

    test_results = model.evaluate(test_ds, verbose=1)

    print(f"\n{'=' * 60}")
    print("FINAL TEST RESULTS")
    print("=" * 60)
    print(f"Test Loss: {test_results[0]:.4f}")
    print(f"Test Accuracy: {test_results[1]:.4f} ({test_results[1]*100:.2f}%)")
    print(f"Test AUC: {test_results[2]:.4f}")
    print("=" * 60)

    summary = {
        "phase": 2,
        "best_epoch": 11,
        "best_val_auc": 0.9689,
        "best_val_accuracy": 0.9636,
        "test_loss": float(test_results[0]),
        "test_accuracy": float(test_results[1]),
        "test_auc": float(test_results[2]),
        "phase1_val_auc": 0.945,
        "improvement": float(test_results[2] - 0.945),
    }

    summary_path = MODEL_SAVE_DIR / "final_test_results.json"
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"\nFinal results saved to: {summary_path}")