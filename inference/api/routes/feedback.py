"""P6 analyst feedback endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from feedback.schema import FeedbackCreate
from feedback.store import append_feedback, load_feedback

router = APIRouter(tags=["feedback"])


@router.post("/feedback")
def submit_feedback(body: FeedbackCreate):
    try:
        rec = append_feedback(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "id": rec.id, "created_at": rec.created_at}


@router.get("/feedback/stats")
def feedback_stats():
    df = load_feedback()
    if not len(df):
        return {"n": 0, "by_action": {}}
    return {
        "n": int(len(df)),
        "by_action": df["action"].value_counts().astype(int).to_dict(),
    }
