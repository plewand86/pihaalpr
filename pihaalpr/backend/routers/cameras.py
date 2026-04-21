from fastapi import APIRouter, HTTPException
from sqlmodel import select
from backend.database.db import get_session
from backend.models.camera import Camera, CameraCreate, CameraRead, CameraUpdate
from backend.services import motion

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


def _should_run_rtsp(cam: Camera) -> bool:
    if not cam.enabled or not cam.rtsp_url:
        return False
    manual_mode = motion.get_manual_mode(cam.id)
    return manual_mode == "start" or (manual_mode != "stop" and cam.rtsp_auto_start)


@router.get("", response_model=list[CameraRead])
def list_cameras():
    with get_session() as session:
        return session.exec(select(Camera)).all()


@router.post("", response_model=CameraRead, status_code=201)
def create_camera(body: CameraCreate):
    if not body.username.strip() or not body.password.strip():
        raise HTTPException(status_code=400, detail="Uzytkownik i haslo sa wymagane przy dodawaniu kamery")

    cam = Camera(**body.model_dump())
    with get_session() as session:
        session.add(cam)
        session.commit()
        session.refresh(cam)
        if _should_run_rtsp(cam):
            motion.clear_manual_mode(cam.id)
            motion.start_camera(
                cam.id,
                cam.name,
                cam.rtsp_url,
                cam.motion_threshold,
                cam.snapshot_url,
                cam.username,
                cam.password,
                cam.rtsp_use_snapshot,
            )
        return cam


@router.get("/{camera_id}", response_model=CameraRead)
def get_camera(camera_id: int):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")
        return cam


@router.put("/{camera_id}", response_model=CameraRead)
def update_camera(camera_id: int, body: CameraUpdate):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")
        data = body.model_dump(exclude_unset=True)
        rtsp_runtime_changed = False
        snapshot_source_changed = False
        for key, value in data.items():
            if key == "password" and not value:
                continue
            if key in {"enabled", "rtsp_url", "rtsp_auto_start", "rtsp_use_snapshot", "motion_threshold"}:
                rtsp_runtime_changed = True
            if key in {"snapshot_url", "username", "password"}:
                snapshot_source_changed = True
            setattr(cam, key, value)
        session.add(cam)
        session.commit()
        session.refresh(cam)
        rtsp_control_changed = rtsp_runtime_changed or (cam.rtsp_use_snapshot and snapshot_source_changed)
        if rtsp_control_changed:
            if not cam.enabled or not cam.rtsp_url:
                motion.request_stop(cam.id)
                motion.stop_camera(cam.id)
            else:
                if "rtsp_auto_start" in data:
                    if cam.rtsp_auto_start:
                        motion.clear_manual_mode(cam.id)
                    else:
                        motion.request_stop(cam.id)
                        motion.stop_camera(cam.id)

                if motion.is_running(cam.id):
                    motion.stop_camera(cam.id)

                if _should_run_rtsp(cam):
                    motion.start_camera(
                        cam.id,
                        cam.name,
                        cam.rtsp_url,
                        cam.motion_threshold,
                        cam.snapshot_url,
                        cam.username,
                        cam.password,
                        cam.rtsp_use_snapshot,
                    )
        return cam


@router.delete("/{camera_id}")
def delete_camera(camera_id: int):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")
        session.delete(cam)
        session.commit()
    motion.request_stop(camera_id)
    motion.stop_camera(camera_id)
    motion.clear_manual_mode(camera_id)
    return {"deleted": camera_id}


@router.post("/{camera_id}/rtsp/start")
def start_rtsp(camera_id: int):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")
        if not cam.enabled:
            raise HTTPException(status_code=400, detail="Kamera jest wylaczona")
        if not cam.rtsp_url:
            raise HTTPException(status_code=400, detail="Brak zapisanego URL RTSP")

    motion.request_start(camera_id)
    motion.start_camera(
        camera_id,
        cam.name,
        cam.rtsp_url,
        cam.motion_threshold,
        cam.snapshot_url,
        cam.username,
        cam.password,
        cam.rtsp_use_snapshot,
    )
    return {"status": "starting", "camera_id": camera_id}


@router.post("/{camera_id}/rtsp/stop")
def stop_rtsp(camera_id: int):
    with get_session() as session:
        cam = session.get(Camera, camera_id)
        if not cam:
            raise HTTPException(status_code=404, detail="Kamera nie znaleziona")

    motion.request_stop(camera_id)
    motion.stop_camera(camera_id)
    return {"status": "stopped", "camera_id": camera_id}
