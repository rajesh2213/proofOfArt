"""Ingest confirmed analyst feedback into a train-only append manifest.

    cd inference
    .\\.venv-gen\\Scripts\\python -m feedback.ingest
    .\\.venv-gen\\Scripts\\python -m feedback.ingest --require-confirmed

Confirmed actions:
  - q1_disagree + q1_label_correct → classification hard example (train)
  - q2_redraw_mask + mask_path → localization supervised row (train)
  - q2_accept_mask → optional positive reinforce (skipped for weight update by default)

Never writes into test/val. group_root is required (or derived) so rebuilds cannot
leak near-dups into held-out splits when merged via build_splits later.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from datagen.taxonomy import AI_LOCAL_EDIT, FULLY_SYNTHETIC, PRISTINE_REAL, Q1_TARGET
from feedback.store import DEFAULT_PATH, ensure_store, load_feedback

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
OUT_CSV = INFERENCE_ROOT / "dataset/manifests/feedback_ingest_v1.csv"
OUT_STATS = OUT_CSV.with_suffix(".stats.json")

COLUMNS = [
    "path", "label", "q1_target", "mask_path", "split", "group_root", "source",
    "editor", "operation", "composite", "mask_ratio", "paired_with", "width", "height",
    "feedback_id", "action",
]

CONFIRMED_Q1 = {"q1_disagree"}
CONFIRMED_Q2 = {"q2_redraw_mask"}


def _group_root(row) -> str:
    gr = str(getattr(row, "group_root", "") or "").strip()
    if gr:
        return gr
    p = Path(str(row.image_path))
    return f"feedback|{p.stem}"


def rows_from_feedback(df: pd.DataFrame, require_confirmed: bool = True) -> pd.DataFrame:
    out = []
    for r in df.itertuples(index=False):
        action = str(r.action)
        path = str(r.image_path)
        if not path:
            continue
        if action in CONFIRMED_Q1 and r.q1_label_correct:
            label = str(r.q1_label_correct)
            if label not in (PRISTINE_REAL, FULLY_SYNTHETIC):
                continue
            out.append({
                "path": path,
                "label": label,
                "q1_target": Q1_TARGET[label],
                "mask_path": "",
                "split": "train",
                "group_root": _group_root(r),
                "source": "feedback",
                "editor": "",
                "operation": "",
                "composite": "",
                "mask_ratio": 0.0,
                "paired_with": "",
                "width": 0,
                "height": 0,
                "feedback_id": r.id,
                "action": action,
            })
        elif action in CONFIRMED_Q2 and r.mask_path:
            out.append({
                "path": path,
                "label": AI_LOCAL_EDIT,
                "q1_target": Q1_TARGET[AI_LOCAL_EDIT],
                "mask_path": str(r.mask_path),
                "split": "train",
                "group_root": _group_root(r),
                "source": "feedback",
                "editor": "analyst_redraw",
                "operation": "mask_correction",
                "composite": "",
                "mask_ratio": 0.0,
                "paired_with": "",
                "width": 0,
                "height": 0,
                "feedback_id": r.id,
                "action": action,
            })
        elif not require_confirmed and action in ("q2_reject_mask", "escalate"):
            # Soft hard-negatives: keep as review-tagged train candidates without masks.
            out.append({
                "path": path,
                "label": PRISTINE_REAL,
                "q1_target": Q1_TARGET[PRISTINE_REAL],
                "mask_path": "",
                "split": "train",
                "group_root": _group_root(r),
                "source": "feedback_soft",
                "editor": "",
                "operation": "",
                "composite": "",
                "mask_ratio": 0.0,
                "paired_with": "",
                "width": 0,
                "height": 0,
                "feedback_id": r.id,
                "action": action,
            })
    if not out:
        return pd.DataFrame(columns=COLUMNS)
    return pd.DataFrame(out)[COLUMNS].drop_duplicates(["path", "feedback_id"])


def ingest(path: Path = DEFAULT_PATH, require_confirmed: bool = True) -> dict:
    ensure_store(path)
    fb = load_feedback(path)
    rows = rows_from_feedback(fb, require_confirmed=require_confirmed)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    rows.to_csv(OUT_CSV, index=False)
    stats = {
        "n_feedback": int(len(fb)),
        "n_ingested": int(len(rows)),
        "by_action": {k: int(v) for k, v in rows.groupby("action").size().items()} if len(rows) else {},
        "out": str(OUT_CSV),
    }
    OUT_STATS.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--require-confirmed", action="store_true", default=True,
                    help="only q1_disagree+label and q2_redraw_mask+mask (default)")
    ap.add_argument("--include-soft", action="store_true",
                    help="also ingest reject/escalate as soft pristine candidates")
    args = ap.parse_args(argv)
    stats = ingest(require_confirmed=not args.include_soft)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
