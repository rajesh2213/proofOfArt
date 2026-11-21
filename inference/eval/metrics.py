from typing import Dict, List, Optional, Sequence

import numpy as np
from PIL import Image
from scipy import ndimage
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve

from eval.adapters.base import DecisionConfig

BOOTSTRAP_ROUNDS = 500
F1_SWEEP = np.round(np.arange(0.1, 0.91, 0.1), 2)
WORK_MAX_SIDE = 1024
PIXEL_AUC_MAX_SIDE = 256


def _ci(values: np.ndarray, stat, rounds: int = BOOTSTRAP_ROUNDS, seed: int = 0) -> Optional[List[float]]:
    if len(values) < 2:
        return None
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(values), size=(rounds, len(values)))
    stats = [stat(values[i]) for i in idx]
    stats = [s for s in stats if s is not None and not np.isnan(s)]
    if not stats:
        return None
    return [float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))]


def _safe_auc(y: np.ndarray, s: np.ndarray) -> Optional[float]:
    if len(np.unique(y)) < 2:
        return None
    return float(roc_auc_score(y, s))


def tpr_at_fpr(y: np.ndarray, s: np.ndarray, target_fpr: float) -> Optional[float]:
    if len(np.unique(y)) < 2:
        return None
    fpr, tpr, _ = roc_curve(y, s)
    return float(np.interp(target_fpr, fpr, tpr))


def fpr_at_tpr(y: np.ndarray, s: np.ndarray, target_tpr: float) -> Optional[float]:
    if len(np.unique(y)) < 2:
        return None
    fpr, tpr, _ = roc_curve(y, s)
    return float(fpr[np.searchsorted(tpr, target_tpr, side="left").clip(max=len(fpr) - 1)])


def balanced_accuracy(y: np.ndarray, s: np.ndarray, thr: float) -> Optional[float]:
    pos, neg = y == 1, y == 0
    if not pos.any() or not neg.any():
        return None
    pred = s >= thr
    return float((pred[pos].mean() + (~pred[neg]).mean()) / 2)


def expected_calibration_error(y: np.ndarray, s: np.ndarray, bins: int = 15) -> float:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(s, edges) - 1, 0, bins - 1)
    ece = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            ece += m.mean() * abs(s[m].mean() - y[m].mean())
    return float(ece)


def classification_metrics(y: Sequence[int], s: Sequence[float], decision: DecisionConfig,
                           with_ci: bool = True) -> Dict:
    y, s = np.asarray(y, dtype=int), np.asarray(s, dtype=float)
    out = {
        "n": int(len(y)),
        "n_synthetic": int((y == 1).sum()),
        "n_real": int((y == 0).sum()),
        "auc": _safe_auc(y, s),
        "ap": float(average_precision_score(y, s)) if len(np.unique(y)) > 1 else None,
        "balanced_acc@0.5": balanced_accuracy(y, s, 0.5),
        "balanced_acc@api": balanced_accuracy(y, s, decision.ai_threshold),
        "tpr@fpr1%": tpr_at_fpr(y, s, 0.01),
        "tpr@fpr5%": tpr_at_fpr(y, s, 0.05),
        "fpr@tpr95%": fpr_at_tpr(y, s, 0.95),
        "fpr@api": float((s[y == 0] >= decision.ai_threshold).mean()) if (y == 0).any() else None,
        "tpr@api": float((s[y == 1] >= decision.ai_threshold).mean()) if (y == 1).any() else None,
        "ece": expected_calibration_error(y, s),
    }
    if with_ci and out["auc"] is not None:
        pairs = np.stack([y, s], axis=1)
        out["auc_ci95"] = _ci(pairs, lambda p: _safe_auc(p[:, 0].astype(int), p[:, 1]), rounds=200)
    return out


def rate_metrics(s: Sequence[float], thr: float, positive: bool) -> Dict:
    """Single-class slice: TPR for synthetic-only, FPR for real-only sources."""
    s = np.asarray(s, dtype=float)
    hits = (s >= thr).astype(float)
    key = "tpr@api" if positive else "fpr@api"
    return {"n": int(len(s)), key: float(hits.mean()) if len(s) else None,
            f"{key}_ci95": _ci(hits, np.mean), "mean_score": float(s.mean()) if len(s) else None}


def _resize_prob(prob: np.ndarray, size) -> np.ndarray:
    return np.asarray(Image.fromarray(prob.astype(np.float32), mode="F").resize(size, Image.BILINEAR))


def _work_size(w: int, h: int, cap: int) -> tuple:
    scale = min(1.0, cap / max(w, h))
    return max(1, round(w * scale)), max(1, round(h * scale))


def decide_mask(prob: np.ndarray, decision: DecisionConfig) -> np.ndarray:
    """Threshold + morphological closing at the model's output resolution (as the API does)."""
    binary = prob > decision.mask_threshold
    if binary.any() and decision.morph_closing > 1:
        k = np.ones((decision.morph_closing, decision.morph_closing), dtype=bool)
        binary = ndimage.binary_closing(binary, structure=k)
    return binary


def localization_image_metrics(prob: np.ndarray, gt: Optional[Image.Image], image_size,
                               decision: DecisionConfig) -> Dict:
    """Per-image metrics at native resolution (long side capped at WORK_MAX_SIDE)."""
    size = _work_size(*image_size, WORK_MAX_SIDE)
    binary_model = decide_mask(prob, decision)
    pred = np.asarray(Image.fromarray(binary_model.astype(np.uint8) * 255).resize(size, Image.NEAREST)) > 127
    area_ratio = float(pred.mean())
    detected = bool(area_ratio >= decision.min_edited_area_ratio
                    and pred.sum() >= decision.min_mask_pixels * (size[0] * size[1]) / (prob.shape[0] * prob.shape[1]))
    out = {"max_prob": float(prob.max()), "area_ratio": area_ratio, "detected": detected}
    if gt is None:
        return out

    gt_arr = np.asarray(gt.convert("L").resize(size, Image.NEAREST)) > 127
    tp = float((pred & gt_arr).sum())
    fp = float((pred & ~gt_arr).sum())
    fn = float((~pred & gt_arr).sum())
    out["f1"] = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) > 0 else 1.0
    out["iou"] = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 1.0
    out["gt_ratio"] = float(gt_arr.mean())

    prob_work = _resize_prob(prob, size)
    for t in F1_SWEEP:
        p = prob_work > t
        tp_t = float((p & gt_arr).sum())
        denom = 2 * tp_t + float((p & ~gt_arr).sum()) + float((~p & gt_arr).sum())
        out[f"f1@{t}"] = 2 * tp_t / denom if denom > 0 else 1.0

    small = _work_size(*image_size, PIXEL_AUC_MAX_SIDE)
    gt_small = np.asarray(gt.convert("L").resize(small, Image.NEAREST)) > 127
    if gt_small.any() and (~gt_small).any():
        out["pixel_auc"] = float(roc_auc_score(gt_small.ravel(), _resize_prob(prob, small).ravel()))
    return out


def aggregate_tampered(rows: List[Dict]) -> Dict:
    if not rows:
        return {"n": 0}
    f1 = np.array([r["f1"] for r in rows])
    iou = np.array([r["iou"] for r in rows])
    sweep = {t: float(np.mean([r[f"f1@{t}"] for r in rows])) for t in F1_SWEEP}
    best_t = max(sweep, key=sweep.get)
    pix = [r["pixel_auc"] for r in rows if "pixel_auc" in r]
    det = np.array([r["detected"] for r in rows], dtype=float)
    return {
        "n": len(rows),
        "f1_mean": float(f1.mean()), "f1_ci95": _ci(f1, np.mean),
        "iou_mean": float(iou.mean()), "iou_ci95": _ci(iou, np.mean),
        "f1_best_global_threshold": float(sweep[best_t]), "best_global_threshold": float(best_t),
        "pixel_auc_mean": float(np.mean(pix)) if pix else None,
        "detection_rate": float(det.mean()), "detection_rate_ci95": _ci(det, np.mean),
    }


def aggregate_pristine(rows: List[Dict]) -> Dict:
    if not rows:
        return {"n": 0}
    det = np.array([r["detected"] for r in rows], dtype=float)
    return {
        "n": len(rows),
        "hallucination_rate": float(det.mean()),
        "hallucination_rate_ci95": _ci(det, np.mean),
        "mean_area_ratio": float(np.mean([r["area_ratio"] for r in rows])),
    }


def image_level_detection(tampered: List[Dict], pristine: List[Dict]) -> Dict:
    if not tampered or not pristine:
        return {}
    y = np.array([1] * len(tampered) + [0] * len(pristine))
    out = {}
    for key in ("max_prob", "area_ratio"):
        s = np.array([r[key] for r in tampered + pristine])
        out[f"auc_by_{key}"] = _safe_auc(y, s)
        out[f"tpr@fpr5%_by_{key}"] = tpr_at_fpr(y, s, 0.05)
    return out
