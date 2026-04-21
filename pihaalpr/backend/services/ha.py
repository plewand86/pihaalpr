import logging
import aiohttp

log = logging.getLogger("ha")

_ha_url = ""
_ha_token = ""


def configure(ha_url: str, ha_token: str) -> None:
    global _ha_url, _ha_token
    _ha_url = ha_url
    _ha_token = ha_token


async def fire_event(event_type: str, data: dict) -> None:
    if not _ha_token:
        return
    headers = {"Authorization": f"Bearer {_ha_token}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{_ha_url}/api/events/{event_type}",
                json=data,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                resp.raise_for_status()
                log.debug("HA event: %s", event_type)
    except aiohttp.ClientResponseError as e:
        log.error("HA event HTTP %d", e.status)
    except Exception as e:
        log.error("HA event błąd: %s", type(e).__name__)


async def call_service(domain: str, service: str, data: dict) -> None:
    if not _ha_token:
        return
    headers = {"Authorization": f"Bearer {_ha_token}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{_ha_url}/api/services/{domain}/{service}",
                json=data,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                resp.raise_for_status()
                log.info("HA service: %s.%s %s", domain, service, data)
    except aiohttp.ClientResponseError as e:
        log.error("HA service HTTP %d (%s.%s)", e.status, domain, service)
    except Exception as e:
        log.error("HA service błąd: %s", type(e).__name__)
