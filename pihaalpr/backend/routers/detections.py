from fastapi import APIRouter
from sqlmodel import select, desc
from backend.database.db import get_session
from backend.models.detection import Detection, DetectionRead

router = APIRouter(prefix="/api/detections", tags=["detections"])


@router.get("", response_model=list[DetectionRead])
def list_detections(limit: int = 100):
    with get_session() as session:
        rows = session.exec(
            select(Detection).order_by(desc(Detection.detected_at)).limit(limit)
        ).all()
        return rows


@router.delete("")
def clear_detections():
    with get_session() as session:
        rows = session.exec(select(Detection)).all()
        for r in rows:
            session.delete(r)
        session.commit()
    return {"deleted": len(rows)}
