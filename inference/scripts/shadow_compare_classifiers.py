"""Offline shadow compare: EfficientNetB0 vs dinoprobe_lora_v2 on a fixed set.

    cd inference
    .\\.venv-eval\\Scripts\\python scripts/shadow_compare_classifiers.py
    .\\.venv-eval\\Scripts\\python scripts/shadow_compare_classifiers.py --limit 200
    .\\.venv-eval\\Scripts\\python scripts/shadow_compare_classifiers.py --images-dir path/to/folder

Emits CSV + JSON under eval/reports/shadow_compare_<timestamp>/ with columns:
path, label (if known), p_ai_b0, p_ai_lora, disagree, latency_ms_b0, latency_ms_lora.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from eval.config import CLASSIFICATION_SPLIT, IMAGE_EXTENSIONS, INFERENCE_ROOT, REPORTS_DIR

DINOPROBE_CANDIDATES = [
    INFERENCE_ROOT / "core/models/ai_detection/best_dinoprobe.pt",
    INFERENCE_ROOT / "core/models/ai_detection/dinoprobe_lora_v2/best.pt",
]
DEFAULT_THRESHOLD = 0.6


def resolve_dinoprobe_ckpt(explicit: Optional[Path]) -> Path:
    if explicit is not None:
        p = explicit if explicit.is_absolute() else INFERENCE_ROOT / explicit
        if not p.exists():
            raise FileNotFoundError(f"dinoprobe checkpoint not found: {p}")
        return p
    for c in DINOPROBE_CANDIDATES:
        if c.exists():
            return c
    raise FileNotFoundError(
        "No dinoprobe checkpoint. Expected one of:\n  "
        + "\n  ".join(str(c) for c in DINOPROBE_CANDIDATES)
    )


def collect_from_split(split: str, limit: Optional[int], seed: int) -> pd.DataFrame:
    df = pd.read_csv(CLASSIFICATION_SPLIT, keep_default_na=False)
    df = df[df["split"] == split].copy()
    if "label" not in df.columns:
        raise ValueError(f"{CLASSIFICATION_SPLIT} missing label column")
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    if limit is not None:
        df = df.head(limit)
    return df[["path", "label"]].reset_index(drop=True)


def collect_from_folder(folder: Path, limit: Optional[int]) -> pd.DataFrame:
    folder = folder if folder.is_absolute() else INFERENCE_ROOT / folder
    if not folder.is_dir():
        raise FileNotFoundError(f"images dir not found: {folder}")
    paths = sorted(
        p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if limit is not None:
        paths = paths[:limit]
    rows = []
    for p in paths:
        try:
            rel = p.resolve().relative_to(INFERENCE_ROOT).as_posix()
        except ValueError:
            rel = str(p)
        rows.append({"path": rel, "label": ""})
    return pd.DataFrame(rows)


def load_rgb(path: str) -> Image.Image:
    full = Path(path)
    if not full.is_absolute():
        full = INFERENCE_ROOT / path
    return Image.open(full).convert("RGB")


def predict_one_b0(model, img: Image.Image) -> Tuple[float, float]:
    from eval.adapters.keras_baseline import api_preprocess

    t0 = time.perf_counter()
    logit = float(model.predict(api_preprocess([img]), verbose=0).reshape(-1)[0])
    # Keras class_names=['ai_generated','real'] → logit is P(real).
    p_ai = float(1.0 - 1.0 / (1.0 + np.exp(-logit)))
    return p_ai, (time.perf_counter() - t0) * 1000.0


def predict_one_lora(model, cfg, device, img: Image.Image, torch_mod) -> Tuple[float, float]:
    from classifier.dataset import imagenet_normalize

    size = int(cfg.get("image_size", 224))
    t0 = time.perf_counter()
    rgb = img.resize((size, size), Image.BILINEAR)
    chw = torch_mod.from_numpy(np.asarray(rgb).astype(np.float32) / 255.0).permute(2, 0, 1)
    batch = imagenet_normalize(chw).unsqueeze(0).to(device)
    with torch_mod.no_grad():
        logit = model(batch)
        p_ai = float(torch_mod.sigmoid(logit).detach().cpu().numpy().reshape(-1)[0])
    return p_ai, (time.perf_counter() - t0) * 1000.0


def summarize(rows: List[dict], threshold: float) -> dict:
    n = len(rows)
    disagrees = sum(1 for r in rows if r["disagree"])
    labeled = [r for r in rows if r.get("label") not in ("", None)]
    summary = {
        "n": n,
        "disagree_n": disagrees,
        "disagree_rate": (disagrees / n) if n else 0.0,
        "threshold": threshold,
        "mean_latency_ms_b0": float(np.mean([r["latency_ms_b0"] for r in rows])) if rows else 0.0,
        "mean_latency_ms_lora": float(np.mean([r["latency_ms_lora"] for r in rows])) if rows else 0.0,
        "mean_abs_delta_p_ai": float(
            np.mean([abs(r["p_ai_b0"] - r["p_ai_lora"]) for r in rows])
        )
        if rows
        else 0.0,
    }
    if labeled:
        y = np.array([int(r["label"]) for r in labeled], dtype=np.int32)
        scores_b0 = np.array([r["p_ai_b0"] for r in labeled], dtype=np.float64)
        scores_lora = np.array([r["p_ai_lora"] for r in labeled], dtype=np.float64)
        # Human / real = label 0 → FPR at threshold
        real_mask = y == 0
        if real_mask.any():
            summary["human_fpr_b0"] = float((scores_b0[real_mask] >= threshold).mean())
            summary["human_fpr_lora"] = float((scores_lora[real_mask] >= threshold).mean())
        try:
            from sklearn.metrics import roc_auc_score

            if len(np.unique(y)) > 1:
                summary["auc_b0"] = float(roc_auc_score(y, scores_b0))
                summary["auc_lora"] = float(roc_auc_score(y, scores_lora))
        except Exception:
            pass
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--split", default="test", help="classification.csv split (default: test)")
    ap.add_argument("--images-dir", type=Path, default=None, help="curated folder instead of split")
    ap.add_argument("--limit", type=int, default=None, help="cap number of images")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--dinoprobe-ckpt", type=Path, default=None)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="output directory (default: eval/reports/shadow_compare_<ts>)",
    )
    args = ap.parse_args(argv)

    if args.images_dir is not None:
        df = collect_from_folder(args.images_dir, args.limit)
    else:
        df = collect_from_split(args.split, args.limit, args.seed)

    if df.empty:
        print(json.dumps({"error": "empty_set"}))
        return 1

    dinoprobe_ckpt = resolve_dinoprobe_ckpt(args.dinoprobe_ckpt)

    print(f"Loading EfficientNetB0 …", flush=True)
    from eval.adapters.keras_baseline import BaselineB0Classifier

    b0 = BaselineB0Classifier()

    print(f"Loading dinoprobe from {dinoprobe_ckpt} …", flush=True)
    import torch
    from classifier.model import load_classifier

    device = "cuda" if torch.cuda.is_available() else "cpu"
    lora_model, lora_cfg = load_classifier(str(dinoprobe_ckpt), device)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_dir = args.out_dir
    if out_dir is None:
        out_dir = REPORTS_DIR / f"shadow_compare_{ts}"
    elif not out_dir.is_absolute():
        out_dir = INFERENCE_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: List[dict] = []
    for i, r in df.iterrows():
        path = r["path"]
        try:
            img = load_rgb(path)
        except Exception as e:
            print(f"skip {path}: {e}", flush=True)
            continue
        p_b0, lat_b0 = predict_one_b0(b0.model, img)
        p_lora, lat_lora = predict_one_lora(lora_model, lora_cfg, device, img, torch)
        pred_b0 = p_b0 >= args.threshold
        pred_lora = p_lora >= args.threshold
        label = r.get("label", "")
        try:
            label_out: object = int(label) if label != "" and label is not None else ""
        except (TypeError, ValueError):
            label_out = label
        rows.append(
            {
                "path": path,
                "label": label_out,
                "p_ai_b0": round(p_b0, 6),
                "p_ai_lora": round(p_lora, 6),
                "disagree": bool(pred_b0 != pred_lora),
                "latency_ms_b0": round(lat_b0, 3),
                "latency_ms_lora": round(lat_lora, 3),
            }
        )
        if (len(rows) % 50) == 0:
            print(f"  {len(rows)}/{len(df)} …", flush=True)

    summary = summarize(rows, args.threshold)
    summary.update(
        {
            "created_at": ts,
            "split": None if args.images_dir else args.split,
            "images_dir": str(args.images_dir) if args.images_dir else None,
            "dinoprobe_ckpt": dinoprobe_ckpt.resolve().relative_to(INFERENCE_ROOT).as_posix()
            if dinoprobe_ckpt.is_relative_to(INFERENCE_ROOT)
            else str(dinoprobe_ckpt),
            "b0_model_id": "baseline_b0",
            "lora_model_id": "dinoprobe_v1",
            "device": device,
            "n_requested": int(len(df)),
            "n_scored": len(rows),
        }
    )

    csv_path = out_dir / "shadow_compare.csv"
    json_path = out_dir / "shadow_compare.json"
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    payload = {"summary": summary, "rows": rows}
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(json.dumps({"out_dir": str(out_dir), "summary": summary}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
