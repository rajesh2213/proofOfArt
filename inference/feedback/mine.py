"""Mine a review queue from recent eval CSVs + feedback disagreements.

    cd inference
    .\\.venv-gen\\Scripts\\python -m feedback.mine
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from eval.config import INFERENCE_ROOT
from feedback.store import DEFAULT_PATH, load_feedback

REPORTS = INFERENCE_ROOT / "eval/reports"
OUT = INFERENCE_ROOT / "dataset/feedback/review_queue.json"


def latest_loc_csv() -> Path | None:
    cands = sorted(REPORTS.glob("*/per_image_localization.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    return cands[0] if cands else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-items", type=int, default=100)
    ap.add_argument("--uncertain-max-prob-low", type=float, default=0.35)
    ap.add_argument("--uncertain-max-prob-high", type=float, default=0.65)
    args = ap.parse_args(argv)

    items = []
    csv_path = latest_loc_csv()
    if csv_path:
        df = pd.read_csv(csv_path, keep_default_na=False)
        clean = df[df["degradation"] == "clean"] if "degradation" in df.columns else df
        # Hallucination candidates: pristine / no-edit detected as edited
        if "kind" in clean.columns:
            hallu = clean[clean["kind"] == "pristine"]
        else:
            hallu = clean[clean["family"].isin(["pristine_real", "pristine_originals", "pristine_all"])]
        if "detected" in hallu.columns:
            for r in hallu[hallu["detected"] == True].head(args.max_items // 2).itertuples(index=False):
                items.append({
                    "reason": "hallucination_candidate",
                    "path": r.path,
                    "max_prob": float(r.max_prob),
                    "family": getattr(r, "family", ""),
                })
        # Weak AI detections: low IoU
        ai = clean[clean["family"] == "ai_local_edit"]
        if "iou" in ai.columns:
            weak = ai.sort_values("iou").head(args.max_items // 2)
            for r in weak.itertuples(index=False):
                items.append({
                    "reason": "weak_ai_localization",
                    "path": r.path,
                    "iou": float(r.iou),
                    "max_prob": float(r.max_prob),
                })

    fb = load_feedback(DEFAULT_PATH)
    if len(fb):
        disag = fb[fb["action"].isin(["q1_disagree", "q2_reject_mask", "q2_redraw_mask", "escalate"])]
        for r in disag.tail(50).itertuples(index=False):
            items.append({
                "reason": "analyst_feedback",
                "path": r.image_path,
                "action": r.action,
                "feedback_id": r.id,
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"n": len(items[: args.max_items]), "items": items[: args.max_items], "source_csv": str(csv_path)}
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(OUT), "n": payload["n"]}, indent=2))


if __name__ == "__main__":
    main()
