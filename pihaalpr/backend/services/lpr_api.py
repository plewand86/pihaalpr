import base64
import logging

import aiohttp

log = logging.getLogger("lpr_api")

_TEST_IMAGE_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII="
)


def _build_form(image_data: bytes, filename: str, content_type: str, api_key: str = "") -> aiohttp.FormData:
    form = aiohttp.FormData()
    form.add_field("fileToUpload", image_data, filename=filename, content_type=content_type)
    if api_key:
        form.add_field("key", api_key)
    return form


def _response_status(data: dict) -> str:
    return str(data.get("status", "")).strip().lower()


def _parse_response(data: dict) -> list[dict]:
    """
    Support common LPR API response formats.
    Look for a results array in: results, plates, detections, data, metadata.
    """
    candidates: list = []
    for key in ("results", "plates", "detections", "data", "metadata"):
        if isinstance(data.get(key), list):
            candidates = data[key]
            break

    plates = []
    for item in candidates:
        plate = item.get("recognition") or item.get("plate") or item.get("number") or item.get("text") or ""
        confidence = item.get("confidence") or item.get("score", 0)
        if isinstance(confidence, float) and confidence <= 1.0:
            confidence = round(confidence * 100, 1)
        else:
            confidence = round(float(confidence), 1)

        width = 0
        box = item.get("box") or item.get("bbox") or item.get("coordinates") or {}
        if isinstance(box, dict):
            width = int(box.get("width") or (box.get("x2", 0) - box.get("x1", 0)) or 0)
        elif isinstance(box, (list, tuple)) and len(box) >= 4:
            width = int(abs(box[2] - box[0]))
        if not width:
            width = int(item.get("width") or 0)

        if plate:
            plates.append({"plate": plate.upper().strip(), "confidence": confidence, "width": width})
    return plates


async def recognize(image_data: bytes, api_url: str, api_key: str = "") -> list[dict]:
    """
    Send image bytes to the external LPR endpoint.
    File goes in field `fileToUpload`, API key in field `key`.
    """
    form = _build_form(image_data, "snapshot.jpg", "image/jpeg", api_key)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(api_url, data=form, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                resp.raise_for_status()
                data = await resp.json(content_type=None)
                log.debug("LPR API response: %s", data)

                if _response_status(data) == "bad key":
                    log.error("LPR API: invalid API key")
                    return []

                results = _parse_response(data)
                log.debug("LPR API: %d results after filtering", len(results))
                return results

    except aiohttp.ClientResponseError as e:
        log.error("LPR API HTTP %d", e.status)
    except aiohttp.ContentTypeError:
        log.error("LPR API returned invalid JSON")
    except aiohttp.ClientError as e:
        log.error("LPR API connection error: %s", type(e).__name__)
    except Exception as e:
        log.error("LPR API unexpected error: %s", type(e).__name__)
    return []


async def test_api_key(api_url: str, api_key: str = "") -> tuple[str, str]:
    form = _build_form(_TEST_IMAGE_BYTES, "test.png", "image/png", api_key)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(api_url, data=form, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                resp.raise_for_status()
                data = await resp.json(content_type=None)
                log.debug("LPR API test response: %s", data)

                if _response_status(data) == "bad key":
                    return "bad_key", 'API odpowiada, ale zwrocilo "bad key". Klucz jest nieprawidlowy lub licencja nieaktywna.'

                return "ok", "Komunikacja z API jest poprawna. Klucz i licencja wygladaja na aktywne."

    except aiohttp.ClientResponseError as e:
        return "error", f"API LPR zwrocilo HTTP {e.status}."
    except aiohttp.ContentTypeError:
        return "error", "API LPR zwrocilo nieprawidlowy JSON."
    except aiohttp.ClientError as e:
        return "error", f"Blad polaczenia z API LPR: {type(e).__name__}."
    except Exception as e:
        return "error", f"Nieoczekiwany blad testu API: {type(e).__name__}."
