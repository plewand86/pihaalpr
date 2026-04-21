import logging
import httpx

log = logging.getLogger("snapshot")

_last_image: bytes | None = None


def get_last_image() -> bytes | None:
    return _last_image


async def fetch_snapshot(url: str, username: str = "", password: str = "") -> tuple[bytes | None, str]:
    """
    Zwraca (bytes, "") przy sukcesie lub (None, "opis błędu").
    Obsługuje Basic i Digest Auth (Hikvision, Dahua itp.).
    """
    global _last_image

    auth = httpx.DigestAuth(username, password) if username else None

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(url, auth=auth)

            if resp.status_code == 401 and username:
                resp = await client.get(url, auth=(username, password))

            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and "octet-stream" not in content_type:
                log.warning("Nieoczekiwany Content-Type: %s", content_type)

            data = resp.content
            _last_image = data
            log.debug("Snapshot %s: %d bajtów", url, len(data))
            return data, ""

    except httpx.HTTPStatusError as e:
        msg = f"HTTP {e.response.status_code} – sprawdź dane dostępu lub URL"
        log.error("Snapshot %s: %s", url, msg)
        return None, msg
    except httpx.ConnectError:
        msg = "Brak połączenia z kamerą – sprawdź IP i sieć"
        log.error("Snapshot %s: ConnectError", url)
        return None, msg
    except httpx.TimeoutException:
        msg = "Timeout – kamera nie odpowiada"
        log.error("Snapshot %s: Timeout", url)
        return None, msg
    except Exception as e:
        msg = f"Błąd: {type(e).__name__}"
        log.error("Snapshot %s: %s", url, e)
        return None, msg
