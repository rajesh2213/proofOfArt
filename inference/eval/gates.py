"""Promotion gate: check a run against ship bars and the frozen baseline.

    cd inference
    python -m eval.gates --report eval/reports/<run>/report.json
    python -m eval.gates --report eval/reports/<run>/report.json --baseline eval/baselines/b0_v1/report.json

Exit code 1 when any gate fails or its slice is missing, so CI can block promotion.
"""
import argparse
import fnmatch
import json
import sys
from pathlib import Path
from typing import Any, List, Optional

from eval.config import GATES_FILE


def resolve(report: dict, path: str) -> List[Any]:
    """Dotted lookup; a segment may be an fnmatch pattern (all matches returned)."""
    nodes = [report]
    parts = path.split(".")
    i = 0
    while i < len(parts):
        nxt = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            # Metric keys may contain dots (e.g. "balanced_acc@0.5"); try the longest key first.
            for j in range(len(parts), i, -1):
                seg = ".".join(parts[i:j])
                if any(ch in seg for ch in "*?["):
                    matches = [v for k, v in node.items() if fnmatch.fnmatch(k, seg)]
                    if matches:
                        nxt.extend((m, j) for m in matches)
                        break
                elif seg in node:
                    nxt.append((node[seg], j))
                    break
        if not nxt:
            return []
        i = nxt[0][1]
        nodes = [n for n, _ in nxt]
    return [n for n in nodes if n is not None]


def worst(values: List[Any], higher_is_better: bool) -> Optional[float]:
    nums = [float(v) for v in values if isinstance(v, (int, float))]
    if not nums:
        return None
    return min(nums) if higher_is_better else max(nums)


def check_absolute(report: dict, gate: dict, min_samples: int) -> dict:
    op = gate["op"]
    higher = op in (">=", ">")
    value = worst(resolve(report, gate["path"]), higher if op != "drop_from" else True)
    result = {"id": gate["id"], "target": f"{op} {gate['value']}", "value": value}
    if value is None:
        return {**result, "status": "MISSING"}
    if "n_path" in gate:
        n = worst(resolve(report, gate["n_path"]), True)
        result["n"] = n
        if n is None or n < min_samples:
            return {**result, "status": "INSUFFICIENT_N"}
    if op == "drop_from":
        ref = worst(resolve(report, gate["ref"]), True)
        if ref is None:
            return {**result, "status": "MISSING"}
        result["value"] = ref - value
        ok = ref - value <= gate["value"]
    elif op == ">=":
        ok = value >= gate["value"]
    elif op == ">":
        ok = value > gate["value"]
    elif op == "<":
        ok = value < gate["value"]
    else:
        ok = value <= gate["value"]
    return {**result, "status": "PASS" if ok else "FAIL"}


def check_vs_baseline(report: dict, baseline: dict, gate: dict) -> dict:
    higher = gate["higher_is_better"]
    cur = worst(resolve(report, gate["path"]), higher)
    base = worst(resolve(baseline, gate["path"]), higher)
    result = {"id": f"vs_baseline:{gate['id']}", "value": cur, "baseline": base,
              "target": (">=" if higher else "<=") + " baseline"}
    if cur is None or base is None:
        return {**result, "status": "MISSING"}
    ok = cur >= base - gate["tolerance"] if higher else cur <= base + gate["tolerance"]
    return {**result, "status": "PASS" if ok else "FAIL"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", required=True, type=Path)
    ap.add_argument("--baseline", type=Path, default=None)
    ap.add_argument("--gates", type=Path, default=GATES_FILE)
    args = ap.parse_args(argv)

    report = json.loads(args.report.read_text())
    cfg = json.loads(args.gates.read_text())
    results = [check_absolute(report, g, cfg.get("min_samples", 0)) for g in cfg["absolute"]]
    if args.baseline:
        baseline = json.loads(args.baseline.read_text())
        if baseline.get("split_version") != report.get("split_version"):
            print(f"Split version mismatch: {baseline.get('split_version')} vs {report.get('split_version')}")
            return 2
        results += [check_vs_baseline(report, baseline, g) for g in cfg["vs_baseline"]]

    width = max(len(r["id"]) for r in results)
    for r in results:
        val = "n/a" if r["value"] is None else f"{r['value']:.4f}"
        extra = f"  baseline={r['baseline']:.4f}" if r.get("baseline") is not None else ""
        extra += f"  n={int(r['n'])}" if r.get("n") is not None else ""
        print(f"{r['status']:<15} {r['id']:<{width}}  value={val:<8} target {r['target']}{extra}")

    (args.report.parent / "gates.json").write_text(json.dumps(results, indent=2))
    failed = [r for r in results if r["status"] != "PASS"]
    print(f"\n{len(results) - len(failed)}/{len(results)} gates passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
