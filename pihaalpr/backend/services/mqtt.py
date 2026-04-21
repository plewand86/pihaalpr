import asyncio
import json
import logging
import os
import time
from collections import deque
from datetime import datetime

import aiohttp
import paho.mqtt.client as mqtt

log = logging.getLogger("mqtt")

_client: mqtt.Client | None = None
_connected = False
_topic_prefix = "pihaalpr"

_event_log: deque = deque(maxlen=200)
_subscribers: list[asyncio.Queue] = []
_loop: asyncio.AbstractEventLoop | None = None


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


def get_log() -> list:
    return list(_event_log)


def _push(kind: str, msg: str, topic: str = "", payload: str = "") -> None:
    event = {
        "ts": datetime.now().strftime("%H:%M:%S"),
        "kind": kind,
        "msg": msg,
        "topic": topic,
        "payload": payload,
    }
    _event_log.append(event)
    if _loop:
        for q in list(_subscribers):
            _loop.call_soon_threadsafe(q.put_nowait, event)


async def fetch_supervisor_mqtt() -> dict | None:
    """Pobiera kredencjały MQTT z HA Supervisor API."""
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    if not token:
        log.warning("SUPERVISOR_TOKEN niedostępny – brak auto-konfiguracji MQTT")
        return None
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "http://supervisor/services/mqtt",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    body = await resp.json()
                    return body.get("data", body)
                log.warning("Supervisor /services/mqtt zwrócił %d", resp.status)
    except Exception as e:
        log.error("Błąd pobierania MQTT z Supervisor: %s", type(e).__name__)
    return None


def _on_connect(client, userdata, flags, rc):
    global _connected
    if rc == 0:
        _connected = True
        client.publish(f"{_topic_prefix}/status", "online", qos=1, retain=True)
        log.info("MQTT połączono")
        _push("connected", "Połączono z brokerem MQTT")
    else:
        log.error("MQTT błąd połączenia rc=%d", rc)
        _push("error", f"Błąd połączenia (rc={rc})")


def _on_disconnect(client, userdata, rc):
    global _connected
    _connected = False
    if rc != 0:
        log.warning("MQTT rozłączono rc=%d", rc)
        _push("error", f"Rozłączono (rc={rc})")


def connect(host: str, port: int, username: str, password: str, topic_prefix: str) -> None:
    global _client, _topic_prefix
    _topic_prefix = topic_prefix

    _client = mqtt.Client(client_id="pihaalpr", clean_session=True)
    _client.on_connect = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.will_set(f"{topic_prefix}/status", "offline", qos=1, retain=True)

    if username:
        _client.username_pw_set(username, password)

    _push("info", f"Łączenie z {host}:{port}…")
    try:
        _client.connect(host, port, keepalive=60)
        _client.loop_start()
        for _ in range(20):
            if _connected:
                return
            time.sleep(0.5)
        log.warning("MQTT: brak połączenia po 10s")
        _push("error", "Brak połączenia po 10s")
    except Exception as e:
        log.error("MQTT connect: %s", type(e).__name__)
        _push("error", f"Wyjątek: {type(e).__name__}")


def set_topic_prefix(prefix: str) -> None:
    global _topic_prefix
    if prefix:
        _topic_prefix = prefix


def disconnect() -> None:
    global _client
    if _client and _connected:
        _client.publish(f"{_topic_prefix}/status", "offline", qos=1, retain=True)
        time.sleep(0.3)
        _client.loop_stop()
        _client.disconnect()


def publish_detection(camera_name: str, plate: str, confidence: float) -> None:
    if not _client or not _connected:
        log.warning("MQTT niedostępne – pomijam publikację")
        _push("error", "Brak połączenia — nie wysłano")
        return
    payload = json.dumps({
        "plate": plate,
        "confidence": confidence,
        "camera": camera_name,
        "timestamp": int(time.time()),
    })
    topic_det = f"{_topic_prefix}/detection"
    topic_plate = f"{_topic_prefix}/last_plate"
    _client.publish(topic_det, payload, qos=1, retain=False)
    _client.publish(topic_plate, plate, qos=1, retain=True)
    log.info("MQTT [%s]: %s (%.1f%%)", camera_name, plate, confidence)
    _push("publish", f"{plate} ({confidence:.1f}%) z kamery {camera_name}", topic=topic_det, payload=payload)
