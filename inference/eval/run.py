"""Score classifier / localizer adapters on the frozen splits.

    cd inference
    python -m eval.run                                   # frozen baseline, all degradations
    python -m eval.run --quick                           # 4 degradations, 150 imgs/source
    python -m eval.run --classifier my_model --localizer none --split test,external:cross_generator_flux

Images an adapter reports as seen in training are excluded unless --include-seen.
"""
import argparse
import json
import shutil
import subprocess
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

from eval.adapters import CLASSIFIERS, LOCALIZERS
from eval.adapters.base import ClassifierAdapter, LocalizerAdapter
from eval.config import (
    AREA_BUCKETS,
    BASELINES_DIR,
    CLASSIFICATION_SPLIT,
    INFERENCE_ROOT,
    LOCALIZATION_SPLIT,
    REPORTS_DIR,
    REQUIRED_SLICES,
    SPLIT_VERSION,
)
from eval.degradations import DEGRADATIONS, QUICK_DEGRADATIONS
from eval.metrics import (
    aggregate_pristine,
    aggregate_tampered,
    classification_metrics,
    image_level_detection,
    localization_image_metrics,
    rate_metrics,
)

LOADER_THREADS = 8


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=INFERENCE_ROOT, text=True).strip()
    except Exception:
        return "unknown"


def load_rgb(path: str) -> Image.Image:
    with Image.open(INFERENCE_ROOT / path) as im:
        return im.convert("RGB")


def load_mask(path: str) -> Optional[Image.Image]:
    if not isinstance(path, str) or not path:
        return None
    with Image.open(INFERENCE_ROOT / path) as im:
        return im.convert("L")


def select_rows(df: pd.DataFrame, splits: List[str]) -> pd.DataFrame:
    return df[df["split"].isin(splits)].copy()


def cap_per_source(df: pd.DataFrame, cap: Optional[int], seed: int = 0) -> pd.DataFrame:
    if not cap:
        return df
    keys = ["source", "family"] if "family" in df.columns else ["source"]
    return df.sample(frac=1, random_state=seed).groupby(keys).head(cap).reset_index(drop=True)


def exclude_seen(df: pd.DataFrame, seen: Optional[set], include_seen: bool) -> (pd.DataFrame, Dict):
    info = {"seen_paths_known": seen is not None, "excluded": 0, "kept": len(df)}
    if seen is None or include_seen:
        return df, info
    mask = df["path"].isin(seen)
    info.update(excluded=int(mask.sum()), kept=int((~mask).sum()))
    return df[~mask].copy(), info


def batched(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def run_classifier(adapter: ClassifierAdapter, rows: pd.DataFrame, degradations: List[str]) -> (Dict, pd.DataFrame):
    records = []
    paths, labels, sources = rows["path"].tolist(), rows["label"].tolist(), rows["source"].tolist()
    ext = rows["split"].tolist()
    with ThreadPoolExecutor(LOADER_THREADS) as pool:
        for deg in degradations:
            fn = DEGRADATIONS[deg]
            def prep(p):
                img, _ = fn(load_rgb(p), None, p)
                return img
            scores = []
            for chunk in tqdm(list(batched(paths, adapter.batch_size)), desc=f"cls/{deg}", leave=False):
                scores.extend(adapter.predict_proba(list(pool.map(prep, chunk))).tolist())
            for p, y, src, sp, sc in zip(paths, labels, sources, ext, scores):
                records.append({"degradation": deg, "path": p, "label": y, "source": src, "split": sp, "score": sc})
    per_image = pd.DataFrame(records)

    report = {}
    thr = adapter.decision.ai_threshold
    for deg, d in per_image.groupby("degradation", sort=False):
        internal = d[~d["split"].str.startswith("external:")]
        entry = {"overall": classification_metrics(internal["label"], internal["score"], adapter.decision)
                 if len(internal) else {"n": 0}}
        by_source = {}
        for src, g in internal.groupby("source"):
            positive = bool(g["label"].iloc[0] == 1)
            by_source[src] = rate_metrics(g["score"], thr, positive)
        entry["by_source"] = by_source
        reals = internal[internal["label"] == 0]
        entry["per_generator_vs_all_real"] = {
            src: classification_metrics(pd.concat([g["label"], reals["label"]]),
                                        pd.concat([g["score"], reals["score"]]), adapter.decision, with_ci=False)
            for src, g in internal[internal["label"] == 1].groupby("source")
        }
        external = {}
        for sp, g in d[d["split"].str.startswith("external:")].groupby("split"):
            external[sp.split(":", 1)[1]] = classification_metrics(g["label"], g["score"], adapter.decision)
        if external:
            entry["external"] = external
        report[deg] = entry
    return report, per_image


def area_bucket(ratio: float) -> str:
    for lo, hi, name in AREA_BUCKETS:
        if lo <= ratio < hi:
            return name
    return AREA_BUCKETS[-1][2]


def run_localizer(adapter: LocalizerAdapter, rows: pd.DataFrame, degradations: List[str]) -> (Dict, pd.DataFrame):
    records = []
    items = rows.to_dict("records")
    with ThreadPoolExecutor(LOADER_THREADS) as pool:
        for deg in degradations:
            fn = DEGRADATIONS[deg]
            def prep(r):
                return fn(load_rgb(r["path"]), load_mask(r.get("mask_path")), r["path"])
            for chunk in tqdm(list(batched(items, adapter.batch_size)), desc=f"loc/{deg}", leave=False):
                pairs = list(pool.map(prep, chunk))
                probs = adapter.predict_prob_maps([img for img, _ in pairs])
                metrics = list(pool.map(
                    lambda args: localization_image_metrics(args[0], args[1][1], args[1][0].size, adapter.decision),
                    zip(probs, pairs)))
                for r, m in zip(chunk, metrics):
                    records.append({"degradation": deg, "path": r["path"], "kind": r["kind"],
                                    "family": r["family"], "source": r["source"], "split": r["split"],
                                    "editor": r.get("editor", ""), "operation": r.get("operation", ""),
                                    "area_bucket": area_bucket(r.get("mask_ratio") or 0.0), **m})
    per_image = pd.DataFrame(records)

    report = {}
    for deg, d in per_image.groupby("degradation", sort=False):
        recs = d.to_dict("records")
        tampered = [r for r in recs if r["kind"] == "tampered" and not r["split"].startswith("external:")]
        pristine_pairs = [r for r in recs if r["family"] == "pristine"]
        pristine_real = [r for r in recs if r["family"] == "pristine_real"]
        by_family = defaultdict(list)
        by_source = defaultdict(list)
        by_area = defaultdict(list)
        by_editor_op = defaultdict(list)
        for r in tampered:
            by_family[r["family"]].append(r)
            by_source[r["source"]].append(r)
            if r["editor"]:
                by_editor_op[f"{r['editor']}:{r['operation']}"].append(r)
            if r["family"] == "ai_local_edit":
                by_area[r["area_bucket"]].append(r)
        entry = {
            "tampered_by_family": {k: aggregate_tampered(v) for k, v in by_family.items()},
            "tampered_by_source": {k: aggregate_tampered(v) for k, v in by_source.items()},
            "tampered_by_editor_operation": {k: aggregate_tampered(v) for k, v in sorted(by_editor_op.items())},
            "ai_local_edit_by_area": {k: aggregate_tampered(v) for k, v in sorted(by_area.items())},
            "pristine_originals": aggregate_pristine(pristine_pairs),
            "pristine_real": aggregate_pristine(pristine_real),
            "pristine_all": aggregate_pristine(pristine_pairs + pristine_real),
            "image_level": {
                fam: image_level_detection(v, pristine_pairs + pristine_real) for fam, v in by_family.items()
            },
        }
        external = defaultdict(lambda: {"tampered": [], "pristine": []})
        for r in recs:
            if r["split"].startswith("external:"):
                external[r["split"].split(":", 1)[1]]["tampered" if r["kind"] == "tampered" else "pristine"].append(r)
        if external:
            entry["external"] = {name: {"tampered": aggregate_tampered(v["tampered"]),
                                        "pristine": aggregate_pristine(v["pristine"])}
                                 for name, v in external.items()}
        report[deg] = entry
    return report, per_image


def measure_latency(predict, images: List[Image.Image]) -> Dict:
    if not images:
        return {}
    predict(images[:1])
    times = []
    for img in images:
        t0 = time.perf_counter()
        predict([img])
        times.append((time.perf_counter() - t0) * 1000)
    return {"n": len(times), "p50_ms": float(np.percentile(times, 50)), "p95_ms": float(np.percentile(times, 95)),
            "batch_size": 1, "note": "single image, includes preprocessing, CPU unless the adapter uses a GPU"}


def fmt(v, pct=False) -> str:
    if v is None:
        return "–"
    return f"{v * 100:.1f}%" if pct else f"{v:.3f}"


def write_summary(report: Dict, path: Path) -> None:
    lines = [f"# Eval run `{report['run_id']}`", "",
             f"Split `{report['split_version']}` · splits {', '.join(report['splits'])} · commit `{report['git_commit'][:10]}`", ""]
    cls = report.get("classification")
    if cls:
        m = report["models"]["classifier"]
        lines += [f"## Q1 whole-image — `{m['name']}`", "",
                  f"Images: {cls['exclusion']['kept']} evaluated, {cls['exclusion']['excluded']} excluded as seen in training.", "",
                  "| Degradation | AUC (95% CI) | Bal. acc @API | TPR @5% FPR | FPR @95% TPR | Human-art FPR @API | ECE |",
                  "|---|---|---|---|---|---|---|"]
        for deg, e in cls["results"].items():
            o = e["overall"]
            ci = o.get("auc_ci95")
            auc = f"{fmt(o.get('auc'))}" + (f" ({ci[0]:.3f}–{ci[1]:.3f})" if ci else "")
            art = e["by_source"].get("wikiart", {}).get("fpr@api")
            lines.append(f"| {deg} | {auc} | {fmt(o.get('balanced_acc@api'), True)} | {fmt(o.get('tpr@fpr5%'), True)} | "
                         f"{fmt(o.get('fpr@tpr95%'), True)} | {fmt(art, True)} | {fmt(o.get('ece'))} |")
        lines.append("")
    loc = report.get("localization")
    if loc:
        m = report["models"]["localizer"]
        lines += [f"## Q2 local edits — `{m['name']}`", "",
                  f"Rows: {loc['exclusion']['kept']} evaluated, {loc['exclusion']['excluded']} excluded as seen in training.", "",
                  "| Degradation | AI-edit IoU | AI-edit F1 | AI-edit n | Traditional IoU | Hallucination (real photos/art) | AI-edit image AUC |",
                  "|---|---|---|---|---|---|---|"]
        for deg, e in loc["results"].items():
            ai = e["tampered_by_family"].get("ai_local_edit", {})
            tr = e["tampered_by_family"].get("traditional_edit", {})
            img = e["image_level"].get("ai_local_edit", {})
            lines.append(f"| {deg} | {fmt(ai.get('iou_mean'))} | {fmt(ai.get('f1_mean'))} | {ai.get('n', 0)} | "
                         f"{fmt(tr.get('iou_mean'))} | {fmt(e['pristine_all'].get('hallucination_rate'), True)} | "
                         f"{fmt(img.get('auc_by_max_prob'))} |")
        lines.append("")
    if report.get("latency"):
        lines += ["## Latency", ""] + [f"- {k}: p50 {v['p50_ms']:.0f} ms, p95 {v['p95_ms']:.0f} ms"
                                       for k, v in report["latency"].items() if v] + [""]
    missing = report["coverage"]["missing_required_slices"]
    if missing:
        lines += ["## Missing required slices (promotion blocked)", ""] + [f"- `{k}`: {v}" for k, v in missing.items()] + [""]
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--classifier", default="baseline_b0", help=f"one of {list(CLASSIFIERS)} or 'none'")
    ap.add_argument("--localizer", default="baseline_b0_multihead_mask", help=f"one of {list(LOCALIZERS)} or 'none'")
    ap.add_argument("--split", default="test", help="comma list: test,val,external:<name>")
    ap.add_argument("--degradations", default="all", help="'all', 'quick' or comma list of " + ",".join(DEGRADATIONS))
    ap.add_argument("--max-per-source", type=int, default=None)
    ap.add_argument("--pristine-real", type=int, default=1000,
                    help="real classification images added as pristine negatives for hallucination rate")
    ap.add_argument("--include-seen", action="store_true")
    ap.add_argument("--latency-samples", type=int, default=30)
    ap.add_argument("--quick", action="store_true", help="--degradations quick --max-per-source 150")
    ap.add_argument("--run-name", default=None)
    ap.add_argument("--freeze-baseline", default=None, metavar="NAME",
                    help="also copy report.json + summary.md to eval/baselines/NAME/")
    args = ap.parse_args(argv)

    if args.quick:
        args.degradations = "quick"
        args.max_per_source = args.max_per_source or 150
    degradations = (list(DEGRADATIONS) if args.degradations == "all"
                    else QUICK_DEGRADATIONS if args.degradations == "quick"
                    else [d.strip() for d in args.degradations.split(",")])
    unknown = [d for d in degradations if d not in DEGRADATIONS]
    if unknown:
        raise SystemExit(f"Unknown degradations: {unknown}")
    if not CLASSIFICATION_SPLIT.exists() or not LOCALIZATION_SPLIT.exists():
        raise SystemExit("Splits not found. Run `python -m eval.build_splits` first.")

    splits = [s.strip() for s in args.split.split(",")]
    cls_df = pd.read_csv(CLASSIFICATION_SPLIT, keep_default_na=False)
    loc_df = pd.read_csv(LOCALIZATION_SPLIT, keep_default_na=False)

    run_id = args.run_name or datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = REPORTS_DIR / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": git_commit(),
        "split_version": SPLIT_VERSION,
        "splits": splits,
        "degradations": degradations,
        "max_per_source": args.max_per_source,
        "include_seen": args.include_seen,
        "models": {},
        "latency": {},
    }

    if args.classifier != "none":
        adapter = CLASSIFIERS[args.classifier]()
        info = adapter.info()
        report["models"]["classifier"] = {**info.__dict__, "decision": adapter.decision.__dict__}
        rows, excl = exclude_seen(select_rows(cls_df, splits), adapter.seen_paths(), args.include_seen)
        rows = cap_per_source(rows, args.max_per_source)
        excl["kept"] = len(rows)
        print(f"[classifier] {info.name}: {len(rows)} images, {excl['excluded']} excluded as seen")
        results, per_image = run_classifier(adapter, rows, degradations)
        per_image.to_csv(out_dir / "per_image_classification.csv", index=False)
        report["classification"] = {"exclusion": excl, "results": results}
        sample = [load_rgb(p) for p in rows["path"].head(args.latency_samples)]
        report["latency"]["classifier"] = measure_latency(adapter.predict_proba, sample)
        del adapter

    if args.localizer != "none":
        adapter = LOCALIZERS[args.localizer]()
        info = adapter.info()
        report["models"]["localizer"] = {**info.__dict__, "decision": adapter.decision.__dict__}
        rows = select_rows(loc_df, splits)
        internal_splits = [s for s in splits if not s.startswith("external:")]
        if args.pristine_real and internal_splits:
            reals = cls_df[(cls_df["split"].isin(internal_splits)) & (cls_df["label"] == 0)]
            reals = reals.sample(min(len(reals), args.pristine_real), random_state=0)
            rows = pd.concat([rows, pd.DataFrame({
                "path": reals["path"], "mask_path": "", "kind": "pristine", "family": "pristine_real",
                "source": reals["source"], "edit_instruction": "", "split": reals["split"], "mask_ratio": 0.0,
            })], ignore_index=True)
        rows, excl = exclude_seen(rows, adapter.seen_paths(), args.include_seen)
        rows = cap_per_source(rows, args.max_per_source)
        excl["kept"] = len(rows)
        print(f"[localizer] {info.name}: {len(rows)} rows, {excl['excluded']} excluded as seen")
        results, per_image = run_localizer(adapter, rows, degradations)
        per_image.to_csv(out_dir / "per_image_localization.csv", index=False)
        report["localization"] = {"exclusion": excl, "results": results}
        sample = [load_rgb(p) for p in rows["path"].head(args.latency_samples)]
        report["latency"]["localizer"] = measure_latency(adapter.predict_prob_maps, sample)

    present_external = {s.split(":", 1)[1] for s in splits if s.startswith("external:")}
    missing = dict(REQUIRED_SLICES)
    for name in present_external:
        for prefix, slice_name in (("cross_generator", "classification_cross_generator"),
                                   ("hard_fakes", "classification_hard_fakes"),
                                   ("object_removal", "localization_object_removal")):
            if name.startswith(prefix):
                missing.pop(slice_name, None)
    report["coverage"] = {"missing_required_slices": missing}

    (out_dir / "report.json").write_text(json.dumps(report, indent=2, default=float))
    write_summary(report, out_dir / "summary.md")
    print(f"wrote {out_dir / 'report.json'} and summary.md")
    if args.freeze_baseline:
        dest = BASELINES_DIR / args.freeze_baseline
        dest.mkdir(parents=True, exist_ok=True)
        for name in ("report.json", "summary.md"):
            shutil.copy2(out_dir / name, dest / name)
        print(f"froze baseline at {dest}")


if __name__ == "__main__":
    main()
