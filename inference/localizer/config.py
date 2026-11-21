from pathlib import Path

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
UNIFIED_MANIFEST = INFERENCE_ROOT / "dataset/manifests/unified_v1.csv"
CHECKPOINT_DIR = INFERENCE_ROOT / "core/models/ai_edit_localization"
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

# ViT-S/14 fits a 4 GB card with a frozen backbone. Input side must be divisible by 14.
BACKBONE = "facebook/dinov2-small"
# 392 = 28x28 patches — fits GTX 1050 Ti 4GB with batch 2. Use 518 on ≥8GB GPUs.
IMAGE_SIZE = 392
PATCH = 14
BATCH_SIZE = 2
NUM_WORKERS = 0  # Windows + CUDA: avoid dataloader worker issues
LR = 1e-3
WEIGHT_DECAY = 0.05
EPOCHS = 12
POS_WEIGHT = 4.0
JPEG_PROB = 0.4
# Patches with edited-pixel fraction >= this are labeled positive.
PATCH_POS_FRAC = 0.25
# Sliding-window inference (~50% overlap)
WINDOW = IMAGE_SIZE
STRIDE = IMAGE_SIZE // 2
