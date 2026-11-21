"""Four-way image provenance taxonomy shared by data generation, training and eval."""

PRISTINE_REAL = "pristine_real"
FULLY_SYNTHETIC = "fully_synthetic"
AI_LOCAL_EDIT = "ai_local_edit"
TRADITIONAL_EDIT = "traditional_edit"

LABELS = [PRISTINE_REAL, FULLY_SYNTHETIC, AI_LOCAL_EDIT, TRADITIONAL_EDIT]

# Q1 (whole-image generation) and Q2 (local edit) targets derived from the label.
# An AI edit on a real photo is NOT fully synthetic; Q1 must stay negative for it.
Q1_TARGET = {PRISTINE_REAL: 0, FULLY_SYNTHETIC: 1, AI_LOCAL_EDIT: 0, TRADITIONAL_EDIT: 0}
HAS_MASK = {PRISTINE_REAL: False, FULLY_SYNTHETIC: False, AI_LOCAL_EDIT: True, TRADITIONAL_EDIT: True}

EDITOR_LABEL = {
    "lama": AI_LOCAL_EDIT,
    "sd15_inpaint": AI_LOCAL_EDIT,
    "legacy_sd15_inpaint": AI_LOCAL_EDIT,
    "opencv_inpaint": TRADITIONAL_EDIT,
    "copy_move": TRADITIONAL_EDIT,
    "manual": TRADITIONAL_EDIT,
}
