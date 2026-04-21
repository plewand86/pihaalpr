import datetime
import json
import logging
import time
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlmodel import select, col

from backend.database.db import get_session
from backend.models.app_setting import AppSetting
from backend.models.camera import Camera
from backend.models.detection import Detection
from backend.models.whitelist import WhitelistEntry
from backend.services import snapshot as snapshot_svc
from backend.services import lpr_api, mqtt, ha, motion

log = logging.getLogger("scheduler")

_scheduler = AsyncIOScheduler()
_last_run: dict[int, float] = {}


def _get_setting(key: str, default: str = "") -> str:
    with get_session() as session:
        row = session.get(AppSetting, key)
        return row.value if row else default


async def _process_detection(cam: Camera, plate: str, conf: float) -> None:
    await _process_detection_by_plate(plate, conf, cam.name)


async def _capture_camera(cam: Camera, lpr_url: str, lpr_key: str, min_conf: int, min_chars: int, min_width: int) -> None:
    image, err = await snapshot_svc.fetch_snapshot(cam.snapshot_url, cam.username, cam.password)
    if not image:
        log.warning("[%s] %s", cam.name, err)
        return

    results = await lpr_api.recognize(image, lpr_url, lpr_key)
    for r in results:
        if r["confidence"] < min_conf:
            continue
        plate, conf = r["plate"], r["confidence"]
        if min_chars and len(plate) < min_chars:
            log.debug("[%s] Odrzucono %s — za mało znaków (%d < %d)", cam.name, plate, len(plate), min_chars)
            continue
        if min_width and r.get("width", 0) < min_width:
            log.debug("[%s] Odrzucono %s — za mała szerokość (%d < %d)", cam.name, plate, r.get("width", 0), min_width)
            continue
        log.info("[%s] Tablica: %s (%.1f%%)", cam.name, plate, conf)
        await _process_detection(cam, plate, conf)


async def _run_capture() -> None:
    """Natychmiastowe przechwycenie wszystkich aktywnych kamer (trigger_now)."""
    lpr_url = _get_setting("lpr_api_url")
    lpr_key = _get_setting("lpr_api_key")
    min_conf = int(_get_setting("min_confidence", "75"))
    min_chars = int(_get_setting("min_chars", "0"))
    min_width = int(_get_setting("min_width", "0"))

    if not lpr_url:
        log.warning("lpr_api_url nie ustawione – pomijam")
        return

    with get_session() as session:
        cameras = session.exec(select(Camera).where(Camera.enabled == True)).all()

    if not cameras:
        log.debug("Brak aktywnych kamer")
        return

    for cam in cameras:
        await _capture_camera(cam, lpr_url, lpr_key, min_conf, min_chars, min_width)


async def _tick() -> None:
    """Tick co 1s — sprawdza per-camera interwały i wyzwala przechwycenie."""
    lpr_url = _get_setting("lpr_api_url")
    if not lpr_url:
        return
    lpr_key = _get_setting("lpr_api_key")
    min_conf = int(_get_setting("min_confidence", "80"))
    min_chars = int(_get_setting("min_chars", "5"))
    min_width = int(_get_setting("min_width", "0"))

    with get_session() as session:
        all_enabled = session.exec(select(Camera).where(Camera.enabled == True)).all()

    now = time.time()
    active_rtsp_ids: set[int] = set()

    for cam in all_enabled:
        # HTTP snapshot auto-capture
        if cam.auto_capture:
            last = _last_run.get(cam.id, 0)
            if now - last >= cam.capture_interval:
                _last_run[cam.id] = now
                await _capture_camera(cam, lpr_url, lpr_key, min_conf, min_chars, min_width)

        # RTSP motion detection
        if cam.rtsp_url:
            manual_mode = motion.get_manual_mode(cam.id)
            should_run_rtsp = manual_mode == "start" or (manual_mode != "stop" and cam.rtsp_auto_start)
            if should_run_rtsp:
                active_rtsp_ids.add(cam.id)
                if not motion.is_running(cam.id):
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

    # Stop RTSP for cameras that are no longer active/configured
    for cam_id in list(motion._stop_events.keys()):
        if cam_id not in active_rtsp_ids:
            motion.stop_camera(cam_id)


async def simulate_detection(plate: str, camera_name: str = "test") -> None:
    """Symuluje wykrycie tablicy — używane przez przycisk Test w białej liście."""
    await _process_detection_by_plate(plate, 100.0, camera_name)


_MAX_DETECTIONS = 100


async def _process_detection_by_plate(plate: str, conf: float, camera_name: str) -> None:
    with get_session() as session:
        session.add(Detection(plate=plate, confidence=conf, camera_name=camera_name))
        session.commit()
        # Zachowaj tylko ostatnie _MAX_DETECTIONS wpisów
        keep_ids = session.exec(
            select(Detection.id).order_by(col(Detection.id).desc()).limit(_MAX_DETECTIONS)
        ).all()
        if len(keep_ids) >= _MAX_DETECTIONS:
            old = session.exec(
                select(Detection).where(col(Detection.id).notin_(keep_ids))
            ).all()
            for d in old:
                session.delete(d)
            session.commit()

    mqtt.set_topic_prefix(_get_setting("mqtt_topic", "pihaalpr"))
    mqtt.publish_detection(camera_name, plate, conf)
    await ha.fire_event("pihaalpr_detection", {
        "plate": plate, "confidence": conf, "camera": camera_name,
    })

    with get_session() as wl_session:
        wl = wl_session.exec(
            select(WhitelistEntry).where(
                WhitelistEntry.plate == plate,
                WhitelistEntry.enabled == True,
            )
        ).first()
    if wl and wl.ha_domain and wl.ha_service:
        svc_data: dict = {}
        if wl.entity_id:
            svc_data["entity_id"] = wl.entity_id
        if wl.service_data:
            try:
                svc_data.update(json.loads(wl.service_data))
            except Exception:
                pass

        if wl.ha_service == "pulse":
            import asyncio
            await ha.call_service(wl.ha_domain, "turn_on", svc_data)
            await asyncio.sleep(2)
            await ha.call_service(wl.ha_domain, "turn_off", svc_data)
        else:
            await ha.call_service(wl.ha_domain, wl.ha_service, svc_data)
        log.info("[test] %s → %s.%s %s", plate, wl.ha_domain, wl.ha_service, svc_data)


def start() -> None:
    _scheduler.add_job(
        _tick,
        trigger=IntervalTrigger(seconds=1),
        id="tick",
        replace_existing=True,
        max_instances=1,
    )
    _scheduler.add_job(
        _run_capture,
        trigger=IntervalTrigger(seconds=3600),
        id="capture",
        replace_existing=True,
        max_instances=1,
        next_run_time=None,
    )
    if not _scheduler.running:
        _scheduler.start()
    log.info("Scheduler start (tick co 1s)")


def trigger_now() -> None:
    _scheduler.modify_job("capture", next_run_time=datetime.datetime.now())


def stop() -> None:
    motion.stop_all()
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
