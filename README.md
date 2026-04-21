# PiHA LPR — License Plate Recognition Add-on for Home Assistant

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Add--on-blue?logo=home-assistant)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Home Assistant add-on do automatycznego rozpoznawania tablic rejestracyjnych z kamer IP. Pobiera snapshoty HTTP, wysyła je do zewnętrznego API LPR i publikuje wyniki przez MQTT oraz zdarzenia HA. Umożliwia automatyczne wywoływanie dowolnych usług Home Assistant po rozpoznaniu zarejestrowanej tablicy (np. otwarcie bramy).

---

## Funkcje

- **Wiele kamer IP** — CRUD do zarządzania kamerami, obsługa HTTP Basic i Digest Auth (Hikvision, Dahua i inne)
- **Zewnętrzne API LPR** — wysyła snapshot jako `multipart/form-data` (`fileToUpload` + `key`) do dowolnego endpointu rozpoznawania tablic
- **Auto-przechwytywanie** — każda kamera może mieć własny interwał (od 1 sekundy)
- **Biała lista** — przypisz dowolną usługę HA do konkretnej tablicy rejestracyjnej (np. `cover.open_cover` dla bramy)
- **EntityPicker** — wyszukiwarka encji Home Assistant w interfejsie białej listy
- **MQTT** — automatyczne wykrywanie danych dostępowych z HA Supervisor, publikacja wykryć do brokera
- **Zdarzenia HA** — wysyłanie zdarzenia `pihaalpr_detection` do automatyzacji
- **Panel webowy** — wbudowany interfejs React dostępny przez HA Ingress

---

## Wymagania

- Home Assistant OS lub Supervised
- Broker MQTT (np. Mosquitto add-on) — opcjonalne, ale zalecane
- Zewnętrzny endpoint API LPR zwracający JSON z kluczem `metadata` / `results` / `plates`

---

## Instalacja

1. W Home Assistant przejdź do **Ustawienia → Dodatki → Sklep z dodatkami**
2. Kliknij menu (⋮) → **Repozytoria** i dodaj:
   ```
   https://github.com/plewand86/pihaalpr
   ```
3. Odśwież stronę, znajdź **PiHA LPR** i kliknij **Zainstaluj**
4. Uruchom dodatek i otwórz interfejs przez **Otwórz interfejs webowy**

---

## Konfiguracja

### Opcje dodatku (`config.yaml`)

| Opcja | Domyślnie | Opis |
|-------|-----------|------|
| `log_level` | `info` | Poziom logowania (`debug`, `info`, `warning`, `error`) |
| `language` | `pl` | Język interfejsu |

### Ustawienia w interfejsie

Przejdź do zakładki **Konfiguracja** w panelu add-ona:

| Pole | Opis |
|------|------|
| URL endpointu LPR | Adres API rozpoznawania tablic (wymagane) |
| Klucz API | Klucz przekazywany jako pole `key` w żądaniu |
| Minimalna pewność (%) | Próg pewności, poniżej którego wykrycia są ignorowane (domyślnie 75%) |

---

## Interfejs webowy

### Dashboard
Podgląd ostatniego snapshota oraz historia wykryć (tablica, kamera, pewność, czas). Przycisk **Wyzwól teraz** natychmiast przechwytuje obraz ze wszystkich aktywnych kamer.

### Kamery
Zarządzanie kamerami IP:
- Adres URL snapshota (HTTP/HTTPS)
- Dane dostępowe (HTTP Basic/Digest Auth)
- **Auto-przechwytywanie** — włącz i ustaw interwał w sekundach (minimum 1s)
- Przycisk **Testuj połączenie** — pobiera podgląd z kamery bez zapisywania

### Biała lista
Lista tablic rejestracyjnych z przypisanymi akcjami HA. Gdy rozpoznana tablica pasuje do wpisu, automatycznie wywoływana jest skonfigurowana usługa HA.

Przykłady akcji:
| Domena | Usługa | Entity ID | Efekt |
|--------|--------|-----------|-------|
| `cover` | `open_cover` | `cover.brama_wjazdowa` | Otwiera bramę |
| `homeassistant` | `turn_on` | `switch.oswietlenie_podjazdu` | Włącza światło |
| `script` | `turn_on` | `script.powiadomienie_domofon` | Uruchamia skrypt |

---

## Format odpowiedzi API LPR

Add-on obsługuje różne formaty JSON. Szukane klucze (w kolejności): `metadata`, `results`, `plates`, `detections`, `data`.

Przykład obsługiwanej odpowiedzi:
```json
{
  "metadata": [
    {
      "recognition": "WA12345",
      "confidence": 91,
      "coordinates": [100, 200, 300, 400]
    }
  ]
}
```

Pole tablicy: `recognition` → `plate` → `number` → `text`  
Pole pewności: `confidence` → `score` (wartości 0–1 są automatycznie przeliczane na %)

---

## MQTT

Jeśli broker MQTT jest dostępny przez HA Supervisor, add-on pobiera dane dostępowe automatycznie.

| Temat | Zawartość |
|-------|-----------|
| `pihaalpr/detection` | `{"plate":"WA12345","confidence":91,"camera":"Brama","timestamp":1234567890}` |
| `pihaalpr/last_plate` | Ostatnio wykryta tablica (retained) |
| `pihaalpr/status` | `online` / `offline` |

---

## Zdarzenia Home Assistant

Po każdym wykryciu add-on wysyła zdarzenie `pihaalpr_detection`:

```yaml
# Przykład automatyzacji
automation:
  trigger:
    platform: event
    event_type: pihaalpr_detection
    event_data:
      plate: "WA12345"
  action:
    service: notify.mobile_app
    data:
      message: "Rozpoznano tablicę {{ trigger.event.data.plate }}"
```

---

## Architektura techniczna

```
Kamera IP (HTTP snapshot)
    ↓
FastAPI backend (Python 3.12, Alpine)
    ↓
Zewnętrzne API LPR (multipart POST)
    ↓
┌───────────────────────────────┐
│  Zapis do SQLite              │
│  Publikacja MQTT              │
│  Zdarzenie HA                 │
│  Akcja HA (biała lista)       │
└───────────────────────────────┘
```

- **Backend**: FastAPI + Uvicorn + SQLModel (SQLite) + APScheduler + aiohttp + httpx
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Integracja HA**: Ingress, Supervisor API (MQTT auto-discovery), HA REST API

---

## Licencja

MIT
