import logging
import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings
from backend.database.db import init_db
from backend.routers import cameras, capture, detections, ha_entities, motion as motion_router, mqtt_log, settings, whitelist
from backend.services import ha, motion, mqtt, scheduler

log = logging.getLogger("main")
APP_VERSION = "2.33.17"


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    loop = asyncio.get_running_loop()
    mqtt.set_loop(loop)
    motion.set_loop(loop)
    cfg = get_settings()
    init_db(cfg.database_url)
    ha.configure(cfg.ha_url, cfg.ha_token)

    mqtt_creds = await mqtt.fetch_supervisor_mqtt()
    if mqtt_creds:
        mqtt.connect(
            host=mqtt_creds.get("host", "core-mosquitto"),
            port=int(mqtt_creds.get("port", 1883)),
            username=mqtt_creds.get("username", ""),
            password=mqtt_creds.get("password", ""),
            topic_prefix="pihaalpr",
        )
    else:
        log.warning("MQTT niedostępne – publikacja wyłączona")

    scheduler.start()
    log.info("PiHA LPR v%s gotowy na :8090", APP_VERSION)
    yield
    scheduler.stop()
    mqtt.disconnect()


app = FastAPI(title="PiHA LPR", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(settings.router)
app.include_router(cameras.router)
app.include_router(detections.router)
app.include_router(capture.router)
app.include_router(whitelist.router)
app.include_router(ha_entities.router)
app.include_router(mqtt_log.router)
app.include_router(motion_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def config():
    return {"language": get_settings().language}


static_dir = get_settings().static_dir
if os.path.isdir(static_dir):
    _index = os.path.join(static_dir, "index.html")
    _no_cache = {"Cache-Control": "no-cache, no-store, must-revalidate"}

    def _render_index() -> str:
        with open(_index, encoding="utf-8") as f:
            html = f.read()
        return re.sub(
            r'(\./assets/[^"\']+)(["\'])',
            lambda m: f'{m.group(1)}{"&" if "?" in m.group(1) else "?"}v={APP_VERSION}{m.group(2)}',
            html,
        )

    @app.get("/")
    async def serve_index():
        return HTMLResponse(_render_index(), headers=_no_cache)

    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")
