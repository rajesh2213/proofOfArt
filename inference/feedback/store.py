"""Append-only CSV store for analyst feedback."""
from __future__ import annotations

import csv
import uuid
from pathlib import Path

from feedback.schema import FEEDBACK_CSV_COLUMNS, FeedbackCreate, FeedbackRecord

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "dataset/feedback/feedback_v1.csv"


def ensure_store(path: Path = DEFAULT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with path.open("w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=FEEDBACK_CSV_COLUMNS).writeheader()
    return path


def append_feedback(item: FeedbackCreate, path: Path = DEFAULT_PATH) -> FeedbackRecord:
    path = ensure_store(path)
    rec = FeedbackRecord.from_create(item, feedback_id=uuid.uuid4().hex[:12])
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FEEDBACK_CSV_COLUMNS)
        w.writerow({k: ("" if getattr(rec, k) is None else getattr(rec, k)) for k in FEEDBACK_CSV_COLUMNS})
    return rec


def load_feedback(path: Path = DEFAULT_PATH):
    import pandas as pd

    path = ensure_store(path)
    return pd.read_csv(path, keep_default_na=False)
