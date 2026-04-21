from fastapi import APIRouter
from pydantic import BaseModel
from backend.database.db import get_session
from backend.models.app_setting import AppSetting, SENSITIVE_KEYS

router = APIRouter(prefix="/api/settings", tags=["settings"])

EDITABLE_KEYS = {"lpr_api_url", "lpr_api_key", "min_confidence", "min_chars", "min_width", "mqtt_topic"}


class SettingsPayload(BaseModel):
    lpr_api_url: str = "https://analytics.app4isp.pl/api/"
    lpr_api_key: str = ""
    min_confidence: int = 80
    min_chars: int = 5
    min_width: int = 0
    mqtt_topic: str = "pihaalpr"


def _get(key: str, default: str = "") -> str:
    with get_session() as session:
        row = session.get(AppSetting, key)
        return row.value if row else default


def _set(key: str, value: str) -> None:
    with get_session() as session:
        row = session.get(AppSetting, key)
        if row:
            row.value = value
        else:
            row = AppSetting(key=key, value=value)
            session.add(row)
        session.commit()


DEFAULTS = {"lpr_api_url": "https://analytics.app4isp.pl/api/", "min_confidence": "80", "min_chars": "5", "min_width": "0", "mqtt_topic": "pihaalpr"}


@router.get("")
def read_settings():
    result = {}
    for key in EDITABLE_KEYS:
        val = _get(key, DEFAULTS.get(key, ""))
        result[key] = "***" if (key in SENSITIVE_KEYS and val) else val
    return result


@router.put("")
def update_settings(payload: SettingsPayload):
    _set("lpr_api_url", payload.lpr_api_url)
    if payload.lpr_api_key and payload.lpr_api_key != "***":
        _set("lpr_api_key", payload.lpr_api_key)
    _set("min_confidence", str(payload.min_confidence))
    _set("min_chars", str(payload.min_chars))
    _set("min_width", str(payload.min_width))
    _set("mqtt_topic", payload.mqtt_topic or "pihaalpr")
    return {"status": "ok"}
