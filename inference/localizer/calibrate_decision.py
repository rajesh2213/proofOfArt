"""Sweep mask decision thresholds for a DinoLizer checkpoint (subset, fast).

    cd inference
    .\\.venv-gen\\Scripts\\python -m localizer.calibrate_decision --max-ai 40 --max-pristine 80
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

from eval.adapters.base import DecisionConfig
from eval.metrics import decide_mask, localization_image_metrics
from localizer.config import CHECKPOINT_DIR, INFERENCE_ROOT, UNIFIED_MANIFEST
from localizer.infer import predict_prob_map
from localizer.model import load_localizer


def _load_sample(max_ai: int, max_pristine: int, seed: int = 0) -> pd.DataFrame:
    df = pd.read_csv(UNIFIED_MANIFEST, keep_default_na=False)
    df = df[df["split"] == "test"]
    ai = df[df["label"] == "ai_local_edit"]
    pr = df[df["label"] == "pristine_real"]
    rng = np.random.default_rng(seed)
    if len(ai) > max_ai:
        ai = ai.iloc[rng.choice(len(ai), size=max_ai, replace=False)]
    if len(pr) > max_pristine:
        pr = pr.iloc[rng.choice(len(pr), size=max_pristine, replace=False)]
    return pd.concat([ai, pr], ignore_index=True)


def score(prob, gt, size, decision: DecisionConfig) -> dict:
    return localization_image_metrics(prob, gt, size, decision)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", type=Path, default=CHECKPOINT_DIR / "best_dinolizer.pt")
    ap.add_argument("--max-ai", type=int, default=40)
    ap.add_argument("--max-pristine", type=int, default=80)
    ap.add_argument("--device", default=None)
    args = ap.parse_args(argv)

    import torch

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    model, cfg = load_localizer(str(args.checkpoint), device)
    window = int(cfg.get("image_size", 392))
    stride = max(window // 2, 1)

    rows = _load_sample(args.max_ai, args.max_pristine)
    print(f"calibrating on {len(rows)} images device={device} ckpt={args.checkpoint}")

    cache = []
    for r in tqdm(rows.itertuples(index=False), total=len(rows)):
        img = Image.open(INFERENCE_ROOT / r.path).convert("RGB")
        gt = None
        if r.mask_path:
            gt = Image.open(INFERENCE_ROOT / r.mask_path).convert("L")
        prob = predict_prob_map(model, img, device, window, stride)
        cache.append({"label": r.label, "prob": prob, "gt": gt, "size": img.size})

    thresholds = [round(x, 2) for x in np.arange(0.35, 0.85, 0.05)]
    areas = [0.001, 0.002, 0.005, 0.01]
    pixels = [50, 100, 200]
    results = []
    for t in thresholds:
        for a in areas:
            for p in pixels:
                dec = DecisionConfig(mask_threshold=t, min_edited_area_ratio=a, min_mask_pixels=p, morph_closing=3)
                ai_iou, hallu = [], []
                for item in cache:
                    m = score(item["prob"], item["gt"], item["size"], dec)
                    if item["label"] == "ai_local_edit":
                        ai_iou.append(m.get("iou", 0.0))
                    else:
                        hallu.append(1.0 if m["detected"] else 0.0)
                row = {
                    "mask_threshold": t,
                    "min_edited_area_ratio": a,
                    "min_mask_pixels": p,
                    "ai_iou": float(np.mean(ai_iou)) if ai_iou else 0.0,
                    "hallucination": float(np.mean(hallu)) if hallu else 0.0,
                }
                # Prefer low hallu then high IoU
                row["score"] = row["ai_iou"] - 0.5 * row["hallucination"]
                results.append(row)

    tab = pd.DataFrame(results).sort_values(["hallucination", "ai_iou"], ascending=[True, False])
    best = tab.iloc[0].to_dict()
    # Also pick best under hallu <= 0.15 if any
    ok = tab[tab["hallucination"] <= 0.15]
    pick = ok.sort_values("ai_iou", ascending=False).iloc[0].to_dict() if len(ok) else best

    out = {
        "checkpoint": str(args.checkpoint),
        "n_ai": int((rows["label"] == "ai_local_edit").sum()),
        "n_pristine": int((rows["label"] == "pristine_real").sum()),
        "recommended": {
            "mask_threshold": float(pick["mask_threshold"]),
            "min_edited_area_ratio": float(pick["min_edited_area_ratio"]),
            "min_mask_pixels": int(pick["min_mask_pixels"]),
            "ai_iou_subset": float(pick["ai_iou"]),
            "hallucination_subset": float(pick["hallucination"]),
        },
        "lowest_hallu": {
            "mask_threshold": float(best["mask_threshold"]),
            "min_edited_area_ratio": float(best["min_edited_area_ratio"]),
            "min_mask_pixels": int(best["min_mask_pixels"]),
            "ai_iou_subset": float(best["ai_iou"]),
            "hallucination_subset": float(best["hallucination"]),
        },
        "top5": tab.head(5).to_dict(orient="records"),
    }
    out_path = CHECKPOINT_DIR / "decision_calibration.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out["recommended"], indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
