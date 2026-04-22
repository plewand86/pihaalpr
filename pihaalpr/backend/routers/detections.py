from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlmodel import select, desc
from backend.database.db import get_session
from backend.models.detection import Detection, DetectionRead

router = APIRouter(prefix="/api/detections", tags=["detections"])


@router.get("", response_model=list[DetectionRead])
def list_detections(limit: int = 100):
    with get_session() as session:
        rows = session.exec(
            select(
                Detection.id,
                Detection.plate,
                Detection.confidence,
                Detection.camera_name,
                Detection.detected_at,
                Detection.image_data.is_not(None).label("has_image"),
            ).order_by(desc(Detection.detected_at)).limit(limit)
        ).all()
        return [
            DetectionRead(
                id=row[0],
                plate=row[1],
                confidence=row[2],
                camera_name=row[3],
                detected_at=row[4],
                has_image=bool(row[5]),
            )
            for row in rows
        ]


@router.get("/{detection_id}/image")
def detection_image(detection_id: int):
    with get_session() as session:
        row = session.get(Detection, detection_id)
        if not row:
            raise HTTPException(status_code=404, detail="Wykrycie nie znalezione")
        if not row.image_data:
            raise HTTPException(status_code=404, detail="Brak obrazu dla tego wykrycia")
        return Response(
            content=row.image_data,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


@router.delete("")
def clear_detections():
    with get_session() as session:
        rows = session.exec(select(Detection)).all()
        for r in rows:
            session.delete(r)
        session.commit()
    return {"deleted": len(rows)}
