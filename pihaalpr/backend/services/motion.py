import asyncio
import io
import logging
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from urllib.parse import quote, urlsplit, urlunsplit

log = logging.getLogger("motion")

_FRAME_W = 1920
_FRAME_H = 1080
_FRAME_BYTES = _FRAME_W * _FRAME_H * 3  # BGR24
_PREVIEW_INTERVAL = 0.25
_LPR_SEND_INTERVAL = 1.0
_LPR_WORKERS = 4

_threads: dict[int, threading.Thread] = {}
_stop_events: dict[int, threading.Event] = {}
_motion_pct: dict[int, float] = {}
_stream_state: dict[int, dict] = {}
_latest_preview: dict[int, bytes] = {}
_latest_preview_ts: dict[int, float] = {}
_last_lpr_send_ts: dict[int, float] = {}
_lpr_inflight: set[int] = set()
_manual_mode: dict[int, str] = {}
_subscribers: list[asyncio.Queue] = []
_loop: asyncio.AbstractEventLoop | None = None
_lpr_lock = threading.Lock()
_lpr_executor = ThreadPoolExecutor(max_workers=_LPR_WORKERS, thread_name_prefix="rtsp-lpr")


def _format_ffmpeg_error(stderr: bytes) -> str:
    text = stderr.decode("utf-8", errors="ignore").strip()
    if not text:
        return "ffmpeg nie zwrocil zadnych danych"

    lower = text.lower()
    if "401 unauthorized" in lower or "403 forbidden" in lower:
        return "RTSP odrzucil autoryzacje - sprawdz login i haslo w URL"
    if "connection refused" in lower:
        return "Polaczenie RTSP odrzucone - sprawdz host i port"
    if "timed out" in lower:
        return "Timeout polaczenia RTSP"
    if "404 not found" in lower or "method describe failed" in lower:
        return "RTSP URL nie istnieje - sprawdz sciezke strumienia"

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else text


def _build_rtsp_url(rtsp_url: str, username: str = "", password: str = "") -> str:
    if not rtsp_url or not username:
        return rtsp_url

    try:
        parts = urlsplit(rtsp_url)
        if not parts.scheme or not parts.hostname:
            return rtsp_url

        host = parts.hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"

        auth = quote(username, safe="")
        if password:
            auth = f"{auth}:{quote(password, safe='')}"

        netloc = f"{auth}@{host}" if auth else host
        if parts.port:
            netloc = f"{netloc}:{parts.port}"

        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        return rtsp_url


async def capture_test_frame(
    rtsp_url: str,
    username: str = "",
    password: str = "",
    timeout: float = 12.0,
) -> tuple[bytes | None, str]:
    auth_rtsp_url = _build_rtsp_url(rtsp_url, username, password)
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", auth_rtsp_url,
            "-vf", f"fps=1,scale={_FRAME_W}:{_FRAME_H}",
            "-frames:v", "1",
            "-pix_fmt", "bgr24",
            "-f", "rawvideo",
            "-an", "-sn", "-dn",
            "-rtbufsize", "0.5M",
            "-probesize", "32",
            "-vsync", "0",
            "-analyzeduration", "1000000",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return None, "ffmpeg nie znaleziono na serwerze"
    except Exception as e:
        return None, f"Blad uruchomienia ffmpeg: {e}"

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return None, "Timeout - brak odpowiedzi strumienia RTSP"

    if proc.returncode not in (0, None):
        return None, _format_ffmpeg_error(stderr)

    if len(stdout) < _FRAME_BYTES:
        err = _format_ffmpeg_error(stderr)
        if err:
            return None, err
        return None, "Nie udalo sie odczytac pelnej klatki RTSP"

    try:
        return _bgr_to_jpeg(stdout[:_FRAME_BYTES]), ""
    except Exception as e:
        log.error("Blad konwersji klatki RTSP do JPEG: %s", e)
        return None, "Nie udalo sie przekonwertowac klatki RTSP"


def _emit_event(event: dict) -> None:
    if not _loop:
        return
    payload = dict(event)
    for q in list(_subscribers):
        _loop.call_soon_threadsafe(q.put_nowait, payload)


def _set_stream_state(cam_id: int, cam_name: str, status: str, message: str = "") -> None:
    current = dict(_stream_state.get(cam_id, {}))
    current.update({
        "cam_id": cam_id,
        "cam_name": cam_name,
        "status": status,
        "message": message,
        "pct": round(_motion_pct.get(cam_id, current.get("pct", 0.0)), 1),
        "updated_at": time.time(),
    })
    _stream_state[cam_id] = current
    _emit_event(current)


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


def get_all_motion() -> dict[int, float]:
    return dict(_motion_pct)


def get_all_state() -> dict[int, dict]:
    return {cam_id: dict(state) for cam_id, state in _stream_state.items()}


def get_latest_preview(camera_id: int) -> bytes | None:
    return _latest_preview.get(camera_id)


def get_latest_preview_ts(camera_id: int) -> float | None:
    return _latest_preview_ts.get(camera_id)


def get_manual_mode(camera_id: int) -> str | None:
    return _manual_mode.get(camera_id)


def request_start(camera_id: int) -> None:
    _manual_mode[camera_id] = "start"


def request_stop(camera_id: int) -> None:
    _manual_mode[camera_id] = "stop"


def clear_manual_mode(camera_id: int) -> None:
    _manual_mode.pop(camera_id, None)


def _push(cam_id: int, cam_name: str, pct: float) -> None:
    _motion_pct[cam_id] = pct
    current = dict(_stream_state.get(cam_id, {}))
    current.update({
        "cam_id": cam_id,
        "cam_name": cam_name,
        "status": current.get("status", "connected"),
        "message": current.get("message", ""),
        "pct": round(pct, 1),
        "updated_at": time.time(),
    })
    _stream_state[cam_id] = current
    _emit_event(current)


def _on_lpr_done(cam_id: int, cam_name: str, future: Future) -> None:
    with _lpr_lock:
        _lpr_inflight.discard(cam_id)
    try:
        future.result()
    except Exception as e:
        log.warning("[%s] Blad analityki RTSP: %s", cam_name, e)


def _schedule_lpr_send(
    cam_id: int,
    cam_name: str,
    now: float,
    bgr_bytes: bytes | None,
    use_snapshot: bool,
    snapshot_url: str,
    snapshot_username: str,
    snapshot_password: str,
) -> None:
    with _lpr_lock:
        last_sent = _last_lpr_send_ts.get(cam_id, 0.0)
        if now - last_sent < _LPR_SEND_INTERVAL or cam_id in _lpr_inflight:
            return
        _last_lpr_send_ts[cam_id] = now
        _lpr_inflight.add(cam_id)

    try:
        future = _lpr_executor.submit(
            _send_to_lpr_sync,
            cam_id,
            cam_name,
            bgr_bytes,
            use_snapshot,
            snapshot_url,
            snapshot_username,
            snapshot_password,
        )
    except Exception:
        with _lpr_lock:
            _lpr_inflight.discard(cam_id)
        raise
    future.add_done_callback(lambda fut: _on_lpr_done(cam_id, cam_name, fut))


def _read_raw_frames(stdout):
    """Reads fixed-size BGR24 frames from ffmpeg rawvideo output."""
    while True:
        data = b""
        remaining = _FRAME_BYTES
        while remaining > 0:
            chunk = stdout.read(remaining)
            if not chunk:
                return
            data += chunk
            remaining -= len(chunk)
        yield data


def _compute_motion(bgr1: bytes, bgr2: bytes) -> float:
    try:
        import numpy as np
        a1 = np.frombuffer(bgr1, dtype=np.uint8).reshape((_FRAME_H, _FRAME_W, 3))
        a2 = np.frombuffer(bgr2, dtype=np.uint8).reshape((_FRAME_H, _FRAME_W, 3))
        g1 = a1[:, :, 1].astype(np.int16)
        g2 = a2[:, :, 1].astype(np.int16)
        diff = np.abs(g1 - g2)
        return float(np.sum(diff > 25)) / diff.size * 100
    except Exception as e:
        log.debug("Blad obliczania motion: %s", e)
        return 0.0


def _bgr_to_jpeg(bgr: bytes) -> bytes:
    import numpy as np
    from PIL import Image

    arr = np.frombuffer(bgr, dtype=np.uint8).reshape((_FRAME_H, _FRAME_W, 3))
    img = Image.fromarray(arr[:, :, ::-1])  # BGR -> RGB
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def _camera_thread(
    cam_id: int,
    cam_name: str,
    rtsp_url: str,
    threshold: float,
    snapshot_url: str,
    snapshot_username: str,
    snapshot_password: str,
    use_snapshot: bool,
    stop_event: threading.Event,
) -> None:
    analysis_mode = "snapshot" if use_snapshot else "klatka RTSP"
    log.info("[%s] Start RTSP (ffmpeg): %s (prog %.1f%%, analiza: %s)", cam_name, rtsp_url, threshold, analysis_mode)
    auth_rtsp_url = _build_rtsp_url(rtsp_url, snapshot_username, snapshot_password)

    while not stop_event.is_set():
        _set_stream_state(cam_id, cam_name, "connecting", "Nawiazywanie polaczenia RTSP")
        try:
            proc = subprocess.Popen(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-re",
                    "-rtsp_transport", "tcp",
                    "-i", auth_rtsp_url,
                    "-vf", f"fps=3,scale={_FRAME_W}:{_FRAME_H}",
                    "-pix_fmt", "bgr24",
                    "-f", "rawvideo",
                    "-an", "-sn", "-dn",
                    "-rtbufsize", "0.5M",
                    "-probesize", "32",
                    "-vsync", "0",
                    "-analyzeduration", "1000000",
                    "-tune", "zerolatency",
                    "pipe:1",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            log.error("ffmpeg nie znaleziono - zainstaluj pakiet ffmpeg")
            _set_stream_state(cam_id, cam_name, "error", "Brak ffmpeg w kontenerze")
            stop_event.wait(30)
            continue
        except Exception as e:
            log.error("[%s] Blad uruchomienia ffmpeg: %s", cam_name, e)
            _set_stream_state(cam_id, cam_name, "error", f"Blad uruchomienia ffmpeg: {e}")
            stop_event.wait(5)
            continue

        prev_frame: bytes | None = None
        preview_ts = 0.0
        connected = False
        try:
            for frame in _read_raw_frames(proc.stdout):
                if stop_event.is_set():
                    break

                now = time.time()
                if not connected:
                    connected = True
                    _set_stream_state(cam_id, cam_name, "connected", "Polaczono ze strumieniem RTSP")

                if now - preview_ts >= _PREVIEW_INTERVAL:
                    try:
                        _latest_preview[cam_id] = _bgr_to_jpeg(frame)
                        _latest_preview_ts[cam_id] = now
                        preview_ts = now
                    except Exception as e:
                        log.debug("[%s] Nie udalo sie zapisac podgladu RTSP: %s", cam_name, e)

                if prev_frame is None:
                    prev_frame = frame
                    continue

                pct = _compute_motion(prev_frame, frame)
                _push(cam_id, cam_name, pct)
                if pct >= threshold:
                    _schedule_lpr_send(
                        cam_id,
                        cam_name,
                        now,
                        None if use_snapshot else frame,
                        use_snapshot,
                        snapshot_url,
                        snapshot_username,
                        snapshot_password,
                    )
                prev_frame = frame
        except Exception as e:
            log.warning("[%s] Blad strumienia: %s", cam_name, e)
            _set_stream_state(cam_id, cam_name, "error", f"Blad strumienia: {e}")
        finally:
            proc.kill()
            proc.wait()

        if not stop_event.is_set():
            log.warning("[%s] Strumien zakonczony, reconnect za 5s", cam_name)
            _set_stream_state(cam_id, cam_name, "reconnecting", "Strumien zakonczony, reconnect za 5s")
            stop_event.wait(5)

    _motion_pct.pop(cam_id, None)
    with _lpr_lock:
        _last_lpr_send_ts.pop(cam_id, None)
        _lpr_inflight.discard(cam_id)
    _set_stream_state(cam_id, cam_name, "stopped", "RTSP zatrzymany")
    log.info("[%s] RTSP zatrzymany", cam_name)


def _send_to_lpr_sync(
    cam_id: int,
    cam_name: str,
    bgr_bytes: bytes | None,
    use_snapshot: bool,
    snapshot_url: str,
    snapshot_username: str,
    snapshot_password: str,
) -> None:
    asyncio.run(
        _send_to_lpr(
            cam_id,
            cam_name,
            bgr_bytes,
            use_snapshot,
            snapshot_url,
            snapshot_username,
            snapshot_password,
        )
    )


async def _send_to_lpr(
    cam_id: int,
    cam_name: str,
    bgr_bytes: bytes | None,
    use_snapshot: bool,
    snapshot_url: str,
    snapshot_username: str,
    snapshot_password: str,
) -> None:
    from backend.services import lpr_api, scheduler
    from backend.services import snapshot as snapshot_svc
    from backend.services.scheduler import _get_setting

    lpr_url = _get_setting("lpr_api_url")
    lpr_key = _get_setting("lpr_api_key")
    min_conf = int(_get_setting("min_confidence", "80"))
    min_chars = int(_get_setting("min_chars", "5"))
    min_width = int(_get_setting("min_width", "0"))

    if not lpr_url:
        return

    if use_snapshot:
        if not snapshot_url:
            log.warning("[%s] Pomijam analize po ruchu - brak URL snapshotu", cam_name)
            return
        image_bytes, err = await snapshot_svc.fetch_snapshot(snapshot_url, snapshot_username, snapshot_password)
        if not image_bytes:
            log.warning("[%s] Snapshot po ruchu nieudany: %s", cam_name, err or "nieznany blad")
            return
    else:
        if not bgr_bytes:
            return
        image_bytes = _bgr_to_jpeg(bgr_bytes)

    results = await lpr_api.recognize(image_bytes, lpr_url, lpr_key)
    for r in results:
        if r["confidence"] < min_conf:
            continue
        plate, conf = r["plate"], r["confidence"]
        if min_chars and len(plate) < min_chars:
            continue
        if min_width and r.get("width", 0) < min_width:
            continue
        source_label = "Snapshot po ruchu" if use_snapshot else "RTSP"
        log.info("[%s] %s tablica: %s (%.1f%%)", cam_name, source_label, plate, conf)
        await scheduler._process_detection_by_plate(plate, conf, cam_name)


def start_camera(
    cam_id: int,
    cam_name: str,
    rtsp_url: str,
    threshold: float,
    snapshot_url: str = "",
    snapshot_username: str = "",
    snapshot_password: str = "",
    use_snapshot: bool = False,
) -> None:
    stop_camera(cam_id)
    stop_event = threading.Event()
    _stop_events[cam_id] = stop_event
    t = threading.Thread(
        target=_camera_thread,
        args=(
            cam_id,
            cam_name,
            rtsp_url,
            threshold,
            snapshot_url,
            snapshot_username,
            snapshot_password,
            use_snapshot,
            stop_event,
        ),
        daemon=True,
        name=f"rtsp-{cam_id}",
    )
    _threads[cam_id] = t
    t.start()


def stop_camera(cam_id: int) -> None:
    if cam_id in _stop_events:
        _stop_events[cam_id].set()
    _stop_events.pop(cam_id, None)
    _threads.pop(cam_id, None)
    _motion_pct.pop(cam_id, None)
    _latest_preview.pop(cam_id, None)
    _latest_preview_ts.pop(cam_id, None)
    with _lpr_lock:
        _last_lpr_send_ts.pop(cam_id, None)
        _lpr_inflight.discard(cam_id)


def stop_all() -> None:
    for ev in _stop_events.values():
        ev.set()
    _stop_events.clear()
    _threads.clear()
    _motion_pct.clear()
    _stream_state.clear()
    _latest_preview.clear()
    _latest_preview_ts.clear()
    with _lpr_lock:
        _last_lpr_send_ts.clear()
        _lpr_inflight.clear()
    _manual_mode.clear()


def is_running(cam_id: int) -> bool:
    t = _threads.get(cam_id)
    return t is not None and t.is_alive()
