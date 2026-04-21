import logging
import aiohttp
from fastapi import APIRouter, Query

from backend.services import ha as ha_svc

log = logging.getLogger("ha_entities")
router = APIRouter(prefix="/api/ha", tags=["ha"])

VALVE_DOMAINS = {"switch", "input_boolean", "light", "fan"}
SENSOR_DOMAINS = {"sensor", "binary_sensor"}
WEATHER_DOMAINS = {"weather"}


async def _fetch_states() -> list[dict]:
    url, token = ha_svc._ha_url, ha_svc._ha_token
    if not token:
        return []
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}/api/states",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                resp.raise_for_status()
                return await resp.json()
    except Exception as e:
        log.error("HA states błąd: %s", type(e).__name__)
        return []


def _to_entity(s: dict) -> dict:
    eid: str = s.get("entity_id", "")
    attrs: dict = s.get("attributes", {})
    return {
        "entity_id": eid,
        "friendly_name": attrs.get("friendly_name", ""),
        "state": s.get("state", ""),
        "domain": eid.split(".")[0] if "." in eid else "",
    }


@router.get("/entities")
async def get_entities(
    domain: str = Query(default=""),
    search: str = Query(default=""),
):
    states = await _fetch_states()
    results = []
    for s in states:
        e = _to_entity(s)
        if domain and e["domain"] != domain:
            continue
        if search:
            q = search.lower()
            if q not in e["entity_id"].lower() and q not in e["friendly_name"].lower():
                continue
        results.append(e)
    results.sort(key=lambda x: x["entity_id"])
    return results


@router.get("/entities/valves")
async def get_valve_entities():
    states = await _fetch_states()
    return sorted(
        [_to_entity(s) for s in states if s.get("entity_id", "").split(".")[0] in VALVE_DOMAINS],
        key=lambda x: x["entity_id"],
    )


@router.get("/entities/sensors")
async def get_sensor_entities():
    states = await _fetch_states()
    result = []
    for s in states:
        eid = s.get("entity_id", "")
        if eid.split(".")[0] not in SENSOR_DOMAINS:
            continue
        e = _to_entity(s)
        attrs = s.get("attributes", {})
        e["unit"] = attrs.get("unit_of_measurement")
        e["device_class"] = attrs.get("device_class")
        result.append(e)
    return sorted(result, key=lambda x: x["entity_id"])


@router.get("/entities/weather")
async def get_weather_entities():
    states = await _fetch_states()
    return sorted(
        [_to_entity(s) for s in states if s.get("entity_id", "").split(".")[0] in WEATHER_DOMAINS],
        key=lambda x: x["entity_id"],
    )
