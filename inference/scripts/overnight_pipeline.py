"""Overnight local-GPU continuation (no Colab, no approvals).

    cd inference
    .\\.venv-gen\\Scripts\\python scripts/overnight_pipeline.py
    .\\.venv-gen\\Scripts\\python scripts/overnight_pipeline.py --skip-train
    .\\.venv-gen\\Scripts\\python scripts/overnight_pipeline.py --phase eval_promote_v4

Phases:
  1) rebuild splits/unified if edits_v2 present and newer than unified
  2) wait/skip dual-v4 if already training elsewhere
  3) eval+promote dual-v4 (hallu gate)
  4) P6 feedback mine+ingest job
  5) optional P2 LoRA probe if --probe
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
V4_DIR = ROOT / "core/models/ai_edit_localization/dinolizer_dual_v4_lowpos"
V4_BEST = V4_DIR / "best.pt"
V4_LAST = V4_DIR / "last.pt"


def run(args: list[str]) -> int:
    print("+", " ".join(args), flush=True)
    return subprocess.call(args, cwd=str(ROOT))


def wait_for_v4(timeout_s: int = 10 * 3600, poll_s: int = 90) -> Path | None:
    """Wait until train_summary.json exists (full 8-epoch run finished)."""
    summary = V4_DIR / "train_summary.json"
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if summary.exists() and V4_BEST.exists():
            return V4_BEST
        # Fallback: last.pt history length >= 8
        if V4_LAST.exists():
            try:
                import torch
                ck = torch.load(V4_LAST, map_location="cpu", weights_only=False)
                hist = ck.get("history") or []
                if len(hist) >= 8 and V4_BEST.exists():
                    return V4_BEST
                print(f"[wait] dual-v4 epochs_done={len(hist)}/8", flush=True)
            except Exception as e:
                print(f"[wait] dual-v4 load last.pt: {e}", flush=True)
        else:
            print("[wait] dual-v4 no last.pt yet", flush=True)
        time.sleep(poll_s)
    return V4_BEST if V4_BEST.exists() else None


def maybe_rebuild_unified():
    edits = ROOT / "dataset/manifests/ai_edits/edits_v2.csv"
    unified = ROOT / "dataset/manifests/unified_v1.csv"
    if edits.exists() and (not unified.exists() or edits.stat().st_mtime > unified.stat().st_mtime + 60):
        run([PY, "-m", "eval.build_splits"])
        run([PY, "-m", "datagen.unified"])
    else:
        print("[skip] unified newer than edits_v2 or edits missing", flush=True)


def phase_eval_promote_v4():
    cand = wait_for_v4()
    if cand is None:
        print(json.dumps({"error": "dual_v4_timeout"}))
        return 1
    return run([
        PY, "scripts/eval_and_promote_localizer.py",
        "--candidate", str(cand.relative_to(ROOT)),
        "--run-name", "dinolizer_dual_v4_lowpos",
        "--prod-hallu-max", "0.30",
        "--prod-iou-min", "0.063",
    ])


def phase_feedback():
    return run([PY, "scripts/retrain_from_feedback.py", "--include-soft"])


def phase_probe():
    return run([
        PY, "-m", "classifier.train",
        "--epochs", "6",
        "--image-size", "224",
        "--batch-size", "4",
        "--lora-r", "8",
        "--lr", "2e-4",
        "--max-per-class", "4000",
        "--run-name", "dinoprobe_lora_v2",
    ])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--phase", default="all",
                    choices=["all", "unified", "eval_promote_v4", "feedback", "probe"])
    ap.add_argument("--skip-train", action="store_true")
    ap.add_argument("--probe", action="store_true")
    args = ap.parse_args(argv)

    if args.phase in ("all", "unified"):
        maybe_rebuild_unified()
    if args.phase in ("all", "eval_promote_v4") and not args.skip_train:
        # Training is assumed already running or finished; only wait+eval+promote.
        rc = phase_eval_promote_v4()
        if rc != 0 and args.phase == "eval_promote_v4":
            return rc
    if args.phase in ("all", "feedback"):
        phase_feedback()
    if args.phase == "probe" or (args.phase == "all" and args.probe):
        phase_probe()
        run([
            PY, "-m", "eval.run",
            "--classifier", "dinoprobe_v1",
            "--localizer", "none",
            "--degradations", "quick",
            "--split", "test",
        ])

    print(json.dumps({"status": "pipeline_complete", "phase": args.phase}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
