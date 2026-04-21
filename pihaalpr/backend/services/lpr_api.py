import logging
import aiohttp

log = logging.getLogger("lpr_api")


def _parse_response(data: dict) -> list[dict]:
    """
    Obsługuje typowe formaty odpowiedzi LPR API.
    Szuka tablicy wyników w kluczach: results, plates, detections, data.
    """
    candidates: list = []
    for key in ("results", "plates", "detections", "data", "metadata"):
        if isinstance(data.get(key), list):
            candidates = data[key]
            break

    plates = []
    for item in candidates:
        plate = (item.get("recognition")
                 or item.get("plate")
                 or item.get("number")
                 or item.get("text") or "")
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
    Wysyła obraz do zewnętrznego endpointu LPR.
    Plik: pole 'fileToUpload', klucz API: pole 'key' (jak w PHP $_REQUEST['key']).
    """
    form = aiohttp.FormData()
    form.add_field("fileToUpload", image_data, filename="snapshot.jpg", content_type="image/jpeg")
    if api_key:
        form.add_field("key", api_key)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(api_url, data=form, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                resp.raise_for_status()
                data = await resp.json(content_type=None)
                log.debug("LPR API response: %s", data)

                if data.get("status") == "bad key":
                    log.error("LPR API: nieprawidłowy klucz API")
                    return []

                results = _parse_response(data)
                log.debug("LPR API: %d wyników po filtrze", len(results))
                return results

    except aiohttp.ClientResponseError as e:
        log.error("LPR API HTTP %d", e.status)
    except aiohttp.ContentTypeError:
        log.error("LPR API zwróciło nieprawidłowy JSON")
    except aiohttp.ClientError as e:
        log.error("LPR API błąd połączenia: %s", type(e).__name__)
    except Exception as e:
        log.error("LPR API nieoczekiwany błąd: %s", type(e).__name__)
    return []
