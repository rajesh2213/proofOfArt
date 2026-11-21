"""Feedback record schema for the reinforcement training loop."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

FeedbackAction = Literal[
    "q1_agree",
    "q1_disagree",
    "q2_accept_mask",
    "q2_reject_mask",
    "q2_redraw_mask",
    "uncertain_helpful",
    "uncertain_not_helpful",
    "escalate",
]


class FeedbackCreate(BaseModel):
    image_path: str = Field(..., description="Inference-root-relative path or URL key")
    action: FeedbackAction
    model_id_q1: Optional[str] = None
    model_id_q2: Optional[str] = None
    q1_label_correct: Optional[Literal["pristine_real", "fully_synthetic"]] = None
    mask_path: Optional[str] = Field(None, description="Corrected mask path if redrawn")
    p_ai: Optional[float] = None
    notes: Optional[str] = None
    group_root: Optional[str] = None


class FeedbackRecord(FeedbackCreate):
    id: str
    created_at: str

    @classmethod
    def from_create(cls, item: FeedbackCreate, feedback_id: str) -> "FeedbackRecord":
        data = item.model_dump() if hasattr(item, "model_dump") else item.dict()
        return cls(
            id=feedback_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            **data,
        )


FEEDBACK_CSV_COLUMNS = [
    "id", "created_at", "image_path", "action", "model_id_q1", "model_id_q2",
    "q1_label_correct", "mask_path", "p_ai", "notes", "group_root",
]
