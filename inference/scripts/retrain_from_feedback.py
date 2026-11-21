"""P6 scheduled job: mine → ingest → (optional) LoRA retrain → gates.

    cd inference
    .\\.venv-gen\\Scripts\\python scripts/retrain_from_feedback.py
    .\\.venv-gen\\Scripts\\python scripts/retrain_from_feedback.py --train --epochs 2

Does not promote automatically. Writes a job report under dataset/feedback/jobs/.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
JOBS = ROOT / "dataset/feedback/jobs"


def run(args: list[str]) -> int:
    print("+", " ".join(args), flush=True)
    return subprocess.call(args, cwd=str(ROOT))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--train", action="store_true", help="run a short LoRA adapter update if ingest > 0")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--include-soft", action="store_true")
    ap.add_argument("--eval", action="store_true", help="quick localizer eval after train")
    args = ap.parse_args(argv)

    JOBS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {"started": stamp, "steps": []}

    rc = run([PY, "-m", "feedback.mine"])
    report["steps"].append({"mine": rc})

    ingest_cmd = [PY, "-m", "feedback.ingest"]
    if args.include_soft:
        ingest_cmd.append("--include-soft")
    rc = run(ingest_cmd)
    report["steps"].append({"ingest": rc})

    stats_path = ROOT / "dataset/manifests/feedback_ingest_v1.stats.json"
    n = 0
    if stats_path.exists():
        n = int(json.loads(stats_path.read_text(encoding="utf-8")).get("n_ingested", 0))
    report["n_ingested"] = n

    if args.train and n > 0:
        init = ROOT / "core/models/ai_edit_localization/best_dinolizer.pt"
        train_cmd = [
            PY, "-m", "localizer.train",
            "--epochs", str(args.epochs),
            "--image-size", "392",
            "--batch-size", "1",
            "--lora-r", "8",
            "--dice-weight", "0.5",
            "--pos-weight", "2.0",
            "--lr", "1e-4",
            "--run-name", f"dinolizer_feedback_{stamp}",
        ]
        if init.exists():
            train_cmd += ["--init-from", str(init)]
        rc = run(train_cmd)
        report["steps"].append({"train": rc})
        if args.eval and rc == 0:
            rc = run([
                PY, "-m", "eval.run",
                "--classifier", "none",
                "--localizer", "dinolizer_v1",
                "--degradations", "quick",
                "--split", "test",
            ])
            report["steps"].append({"eval": rc})
    else:
        report["train_skipped"] = "no confirmed rows" if n == 0 else "pass --train to enable"

    out = JOBS / f"job_{stamp}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(out), **report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
