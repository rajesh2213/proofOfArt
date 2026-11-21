"""Load FusionConfig from decision_calibration.json when present."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from fusion.policy import FusionConfig

DEFAULT_CALIB = (
    Path(__file__).resolve().parent.parent
    / "core/models/ai_edit_localization/decision_calibration.json"
)


def load_fusion_config(path: Optional[Path] = None) -> FusionConfig:
    path = Path(path or DEFAULT_CALIB)
    cfg = FusionConfig()
    if not path.exists():
        return cfg
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        rec = data.get("recommended") or {}
        if "mask_threshold" in rec:
            cfg.mask_threshold = float(rec["mask_threshold"])
        if "min_edited_area_ratio" in rec:
            cfg.min_edited_area_ratio = float(rec["min_edited_area_ratio"])
        if "min_mask_pixels" in rec:
            cfg.min_mask_pixels = int(rec["min_mask_pixels"])
    except Exception:
        pass
    return cfg
