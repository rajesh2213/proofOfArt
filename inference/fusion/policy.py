"""P4 fusion policy: keep Q1 (whole-image) and Q2 (local edit) separate.

Never fuse into one score. This module only packages the two answers with
calibration bands and optional provenance override.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class FusionConfig:
    ai_threshold: float = 0.7
    uncertain_low: float = 0.6
    mask_threshold: float = 0.45
    min_edited_area_ratio: float = 0.01
    min_mask_pixels: int = 200
    # If C2PA / provenance asserts camera-captured original, suppress AI label.
    honor_provenance_real: bool = True


@dataclass
class Q1Result:
    p_ai: float
    is_ai_generated: bool
    is_uncertain: bool
    model_id: str


@dataclass
class Q2Result:
    detected: bool
    edited_area_ratio: float
    edited_pixels: int
    model_id: str


@dataclass
class FusedVerdict:
    q1: Q1Result
    q2: Q2Result
    notes: list


def decide_q1(p_ai: float, cfg: FusionConfig, model_id: str, provenance_real: bool = False) -> Q1Result:
    if cfg.honor_provenance_real and provenance_real:
        return Q1Result(p_ai=p_ai, is_ai_generated=False, is_uncertain=False, model_id=model_id)
    if p_ai >= cfg.ai_threshold:
        return Q1Result(p_ai=p_ai, is_ai_generated=True, is_uncertain=False, model_id=model_id)
    if p_ai >= cfg.uncertain_low:
        return Q1Result(p_ai=p_ai, is_ai_generated=False, is_uncertain=True, model_id=model_id)
    return Q1Result(p_ai=p_ai, is_ai_generated=False, is_uncertain=False, model_id=model_id)


def decide_q2(
    edited_pixels: int,
    total_pixels: int,
    cfg: FusionConfig,
    model_id: str,
) -> Q2Result:
    ratio = edited_pixels / max(total_pixels, 1)
    detected = edited_pixels >= cfg.min_mask_pixels and ratio >= cfg.min_edited_area_ratio
    return Q2Result(
        detected=detected,
        edited_area_ratio=float(ratio),
        edited_pixels=int(edited_pixels),
        model_id=model_id,
    )


def fuse(
    p_ai: float,
    edited_pixels: int,
    total_pixels: int,
    cfg: Optional[FusionConfig] = None,
    classifier_id: str = "baseline_b0",
    localizer_id: str = "dinolizer_v1",
    provenance_real: bool = False,
) -> FusedVerdict:
    cfg = cfg or FusionConfig()
    q1 = decide_q1(p_ai, cfg, classifier_id, provenance_real=provenance_real)
    q2 = decide_q2(edited_pixels, total_pixels, cfg, localizer_id)
    notes = []
    if q1.is_ai_generated and q2.detected:
        notes.append("whole_image_ai_and_local_edit_both_fired — report both; do not merge")
    if provenance_real and q1.is_ai_generated is False:
        notes.append("provenance_override_real")
    return FusedVerdict(q1=q1, q2=q2, notes=notes)
