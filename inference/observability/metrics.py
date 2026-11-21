"""Structured production metrics events (JSON lines).

Emit from analyze / serve_pytorch; ship to a log shipper or scrape the file.

    from observability.metrics import emit, AnalyzeMetrics
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

INFERENCE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOG = INFERENCE_ROOT / "dataset/logs/prod_metrics.jsonl"


@dataclass
class AnalyzeMetrics:
    event: str = "analyze"
    ts: float = field(default_factory=lambda: time.time())
    model_id_q1: Optional[str] = None
    model_id_q2: Optional[str] = None
    p_ai: Optional[float] = None
    q1_ai: Optional[bool] = None
    q1_uncertain: Optional[bool] = None
    q2_detected: Optional[bool] = None
    edited_area_ratio: Optional[float] = None
    edited_pixels: Optional[int] = None
    latency_ms: Optional[float] = None
    ok: bool = True
    error: Optional[str] = None


def emit(m: AnalyzeMetrics, path: Path = DEFAULT_LOG) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(m), ensure_ascii=False) + "\n")
