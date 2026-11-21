from pathlib import Path

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_v1.csv"
CHECKPOINT_DIR = INFERENCE_ROOT / "core/models/ai_detection"
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

BACKBONE = "facebook/dinov2-small"
IMAGE_SIZE = 224
BATCH_SIZE = 16
NUM_WORKERS = 0
LR = 1e-3
WEIGHT_DECAY = 0.05
EPOCHS = 8
JPEG_PROB = 0.4
# Cap per class so train isn't dominated by one source.
MAX_PER_CLASS = 4000
