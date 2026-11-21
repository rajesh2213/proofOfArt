"""After a localizer train: quick eval → gates → promote only if hallu does not regress.

    cd inference
    .\\.venv-gen\\Scripts\\python scripts/eval_and_promote_localizer.py \\
        --candidate core/models/ai_edit_localization/dinolizer_dual_v4_lowpos/best.pt \\
        --run-name dinolizer_dual_v4_lowpos
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
PROD = ROOT / "core/models/ai_edit_localization/best_dinolizer.pt"
BASELINE = ROOT / "eval/baselines/b0_v1/report.json"


def run(args: list[str]) -> int:
    print("+", " ".join(args), flush=True)
    return subprocess.call(args, cwd=str(ROOT))


def latest_report() -> Path | None:
    reports = sorted((ROOT / "eval/reports").glob("*/report.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return reports[0] if reports else None


def hallu_and_iou(report: dict) -> tuple[float | None, float | None]:
    """Parse eval.run report: localization.results.<deg>.…"""
    ai_iou = None
    hallu = None
    results = ((report.get("localization") or {}).get("results") or {})
    # Prefer clean; else first degradation block
    block = results.get("clean") or (next(iter(results.values()), None) if results else None)
    if isinstance(block, dict):
        ai = ((block.get("tampered_by_family") or {}).get("ai_local_edit") or {})
        if "iou_mean" in ai:
            ai_iou = float(ai["iou_mean"])
        for key in ("pristine_all", "pristine_originals", "pristine_real"):
            pr = block.get(key) or {}
            if "hallucination_rate" in pr:
                hallu = float(pr["hallucination_rate"])
                break
    summary = report.get("summary") or {}
    if ai_iou is None and summary.get("ai_edit_iou") is not None:
        ai_iou = float(summary["ai_edit_iou"])
    if hallu is None and summary.get("hallucination") is not None:
        hallu = float(summary["hallucination"])
    return ai_iou, hallu


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--candidate", type=Path, required=True)
    ap.add_argument("--run-name", default="candidate")
    ap.add_argument("--prod-hallu-max", type=float, default=0.30,
                    help="do not promote if candidate hallu exceeds this (LoRA v2 ~0.26)")
    ap.add_argument("--require-iou-gain", action="store_true")
    ap.add_argument("--prod-iou-min", type=float, default=0.063)
    ap.add_argument("--skip-eval", action="store_true", help="use latest report only")
    ap.add_argument("--force-promote", action="store_true")
    args = ap.parse_args(argv)

    cand = args.candidate if args.candidate.is_absolute() else ROOT / args.candidate
    if not cand.exists():
        print(json.dumps({"error": "missing_candidate", "path": str(cand)}))
        return 1

    # Stage candidate as best_dinolizer for eval adapter (backup prod first)
    backup = ROOT / "core/models/ai_edit_localization" / f"best_dinolizer_pre_{args.run_name}.pt"
    if PROD.exists() and not backup.exists():
        shutil.copy2(PROD, backup)
    staged = ROOT / "core/models/ai_edit_localization" / f"candidate_{args.run_name}.pt"
    shutil.copy2(cand, staged)
    shutil.copy2(cand, PROD)

    if not args.skip_eval:
        rc = run([
            PY, "-m", "eval.run",
            "--classifier", "none",
            "--localizer", "dinolizer_v1",
            "--degradations", "quick",
            "--split", "test",
        ])
        if rc != 0:
            # restore prod
            if backup.exists():
                shutil.copy2(backup, PROD)
            return rc

    report_path = latest_report()
    if report_path is None:
        print(json.dumps({"error": "no_report"}))
        if backup.exists():
            shutil.copy2(backup, PROD)
        return 1

    report = json.loads(report_path.read_text(encoding="utf-8"))
    ai_iou, hallu = hallu_and_iou(report)
    gates_rc = run([PY, "-m", "eval.gates", "--report", str(report_path), "--baseline", str(BASELINE)])

    promote = args.force_promote
    reason = []
    if not promote:
        if hallu is not None and hallu > args.prod_hallu_max:
            reason.append(f"hallu {hallu:.3f} > max {args.prod_hallu_max}")
        elif hallu is None:
            reason.append("hallu_missing")
        if args.require_iou_gain and (ai_iou is None or ai_iou < args.prod_iou_min):
            reason.append(f"iou {ai_iou} < prod {args.prod_iou_min}")
        if not reason and hallu is not None and hallu <= args.prod_hallu_max:
            if ai_iou is None or ai_iou >= args.prod_iou_min * 0.9:
                promote = True
                reason.append("hallu_ok_and_iou_acceptable")
            else:
                reason.append("iou_too_low")

    result = {
        "candidate": str(cand),
        "report": str(report_path),
        "ai_iou": ai_iou,
        "hallu": hallu,
        "gates_rc": gates_rc,
        "promote": promote,
        "reason": reason,
    }

    if promote:
        promoted = ROOT / "core/models/ai_edit_localization" / f"best_{args.run_name}_promoted.pt"
        shutil.copy2(cand, promoted)
        shutil.copy2(cand, PROD)
        result["prod"] = str(PROD)
        result["promoted_copy"] = str(promoted)
    else:
        # restore previous prod
        if backup.exists():
            shutil.copy2(backup, PROD)
            result["restored"] = str(backup)
        result["note"] = "kept previous prod weights"

    out = ROOT / "eval/reports" / f"promote_{args.run_name}.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if promote or gates_rc == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
