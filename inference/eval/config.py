from pathlib import Path

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
EVAL_ROOT = INFERENCE_ROOT / "eval"

CLASSIFICATION_DIR = INFERENCE_ROOT / "dataset/images/classification"
TAMPER_DIR = INFERENCE_ROOT / "dataset/images/tamper_localization"
TAMPER_MANIFEST = INFERENCE_ROOT / "dataset/manifests/tamper_manifest.csv"
EXTERNAL_DIR = EVAL_ROOT / "external"
GENERATED_MANIFEST_DIR = INFERENCE_ROOT / "dataset/manifests/ai_edits"

SPLITS_DIR = EVAL_ROOT / "splits"
CLASSIFICATION_SPLIT = SPLITS_DIR / "classification.csv"
LOCALIZATION_SPLIT = SPLITS_DIR / "localization.csv"
SPLIT_REPORT = SPLITS_DIR / "split_report.json"
REPORTS_DIR = EVAL_ROOT / "reports"
BASELINES_DIR = EVAL_ROOT / "baselines"
GATES_FILE = EVAL_ROOT / "gates.json"

# Bumping this salt reshuffles every group, which invalidates all historical
# comparisons. Only change it together with a new split version.
SPLIT_VERSION = "v1"
SPLIT_SALT = "proofofart-eval-v1"
SPLIT_FRACTIONS = {"train": 0.70, "val": 0.15, "test": 0.15}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# Generators or editors that pass pixels through a latent diffusion inpainter.
AI_EDIT_SOURCES = {"coco", "laion", "wikiart"}
# Manual, human-made manipulations (Photoshop splicing, clone-stamp, etc).
TRADITIONAL_EDIT_SOURCES = {"imd2020"}

# Slices the plan requires before a model can be promoted. The harness reports
# them as missing until matching data exists under eval/external/.
REQUIRED_SLICES = {
    "classification_cross_generator": "Synthetic images from a generator absent from training (eval/external/<name>/fake + real).",
    "classification_hard_fakes": "Chameleon-style photorealistic fakes that fool humans.",
    "localization_object_removal": "Object-removal edits (LaMa / Flux Fill / commercial erasers) with masks.",
}

AREA_BUCKETS = [(0.0, 0.02, "<2%"), (0.02, 0.10, "2-10%"), (0.10, 0.30, "10-30%"), (0.30, 1.01, ">30%")]
