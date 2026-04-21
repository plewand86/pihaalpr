from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from backend.database.db import get_session
from backend.models.camera import Camera
from backend.services import motion
from backend.services import scheduler
from backend.services import snapshot as snapshot_svc

router = APIRouter(prefix="/api/capture", tags=["capture"])


class TestSnapshotRequest(BaseModel):
    snapshot_url: str
    username: str = ""
    password: str = ""
    camera_id: int | None = None


class RtspTestRequest(BaseModel):
    rtsp_url: str
    username: str = ""
    password: str = ""
    camera_id: int | None = None


@router.post("/trigger")
async def trigger():
    scheduler.trigger_now()
    return {"status": "triggered"}


@router.post("/test")
async def test_snapshot(body: TestSnapshotRequest):
    if not body.snapshot_url:
        raise HTTPException(status_code=400, detail="snapshot_url jest wymagane")

    username = body.username
    password = body.password
    if not password and body.camera_id is not None:
        with get_session() as session:
            cam = session.get(Camera, body.camera_id)
            if cam:
                username = cam.username
                password = cam.password

    image, err = await snapshot_svc.fetch_snapshot(body.snapshot_url, username, password)
    if not image:
        raise HTTPException(status_code=503, detail=err or "Nie udało się pobrać obrazu")
    return Response(content=image, media_type="image/jpeg")


@router.post("/rtsp_test")
async def test_rtsp(body: RtspTestRequest):
    rtsp_url = body.rtsp_url.strip()
    if not rtsp_url:
        raise HTTPException(status_code=400, detail="rtsp_url jest wymagane")

    username = body.username
    password = body.password
    if body.camera_id is not None and (not username or not password):
        with get_session() as session:
            cam = session.get(Camera, body.camera_id)
            if cam:
                username = username or cam.username
                password = password or cam.password

    image, err = await motion.capture_test_frame(rtsp_url, username, password)
    if not image:
        raise HTTPException(status_code=503, detail=err or "Nie udało się pobrać klatki RTSP")
    return Response(content=image, media_type="image/jpeg")


@router.get("/snapshot/{camera_id}")
async def get_snapshot(camera_id: int):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")

    image, err = await snapshot_svc.fetch_snapshot(cam.snapshot_url, cam.username, cam.password)
    if not image:
        raise HTTPException(status_code=503, detail=err)
    return Response(content=image, media_type="image/jpeg")


@router.get("/snapshot")
async def get_last_snapshot():
    image = snapshot_svc.get_last_image()
    if not image:
        raise HTTPException(status_code=404, detail="Brak obrazu")
    return Response(content=image, media_type="image/jpeg")
