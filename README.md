# PiHA LPR

[Polski](#polski) | [English](#english)

## Polski

Home Assistant add-on do rozpoznawania tablic rejestracyjnych z kamer IP. Aplikacja laczy HTTP snapshot, RTSP, zewnetrzne API LPR, MQTT i akcje Home Assistant w jednym panelu webowym dostepnym przez Ingress.

### Co potrafi

- wiele kamer IP z osobnymi ustawieniami HTTP snapshot i RTSP
- live preview RTSP w edycji kamery oraz na dashboardzie
- detekcja ruchu na RTSP z progiem per kamera
- tryb `RTSP tylko do detekcji`, a analiza przez HTTP snapshot
- reczny start i stop worker-a RTSP albo autostart po zapisie
- dashboard pokazujacy live RTSP lub odswiezany snapshot dla kazdej aktywnej kamery
- lista wykryc odswiezana na biezaco
- MQTT z logiem live i konfigurowalnym prefiksem topiku
- biala lista tablic z automatycznym wywolaniem uslugi Home Assistant

### Instalacja w Home Assistant

1. Wejdz w `Ustawienia -> Dodatki -> Sklep z dodatkami`.
2. Dodaj repozytorium:

   ```text
   https://github.com/plewand86/pihaalpr
   ```

3. Zainstaluj dodatek `PiHA LPR`.
4. Uruchom dodatek i otworz interfejs przez `Otworz interfejs webowy`.

### Konfiguracja

Zakladka `Konfiguracja` zawiera:

- `URL endpointu LPR`: domyslnie `https://api-alpr.app4isp.pl/`
- `Klucz API`: wysylany jako pole `key`
- `Minimalna pewnosc (%)`
- `Min. ilosc znakow`
- `Min. szerokosc tablicy (px)`
- `Topik MQTT`

### Kamery

Przy dodawaniu kamery podajesz:

- nazwe kamery
- `snapshot_url`
- `username` i `password`
- opcjonalny `rtsp_url`

RTSP korzysta z pol `username` i `password`, nie z danych wpisanych w sam URL. Dla RTSP dostepne sa:

- test pojedynczej klatki
- live preview worker-a
- status polaczenia
- prog ruchu
- `Uruchamiaj RTSP automatycznie`
- `Wysylaj do analizy przez snapshot`
- przyciski `Start` i `Stop`

### Dashboard

Dashboard pokazuje wszystkie aktywne kamery:

- jesli kamera ma RTSP, wyswietlany jest live preview RTSP i poziom ruchu
- jesli kamera nie ma RTSP, wyswietlany jest snapshot HTTP odswiezany cyklicznie bez wyzwalania analityki

Po prawej stronie widoczna jest lista wykryc z numerem tablicy, kamera, pewnoscia i czasem.

### Biala lista

Zakladka `Biala lista` pozwala powiazac tablice z akcja HA. Po rozpoznaniu tablicy mozna wywolac np.:

- `cover.open_cover`
- `switch.turn_on`
- `light.turn_on`
- `automation.trigger`
- `script.turn_on`

Dostepny jest tez test wpisu bez czekania na prawdziwe wykrycie.

### MQTT i zdarzenia

Add-on publikuje wykrycia do MQTT i wysyla zdarzenie `pihaalpr_detection` do Home Assistant. Prefiks MQTT ustawiasz w zakladce `Konfiguracja`.

Przykladowe tematy:

- `pihaalpr/detection`
- `pihaalpr/last_plate`
- `pihaalpr/status`

### Oczekiwany format API LPR

PiHA LPR akceptuje odpowiedzi JSON zawierajace wyniki w kluczach:

- `metadata`
- `results`
- `plates`
- `detections`
- `data`

Pole tablicy moze byc odczytane m.in. z:

- `recognition`
- `plate`
- `number`
- `text`

Pole pewnosci moze byc odczytane m.in. z:

- `confidence`
- `score`

### Stack

- backend: FastAPI, SQLModel, APScheduler
- frontend: React, TypeScript, Vite, Tailwind CSS
- runtime: Home Assistant Ingress, MQTT, SQLite, ffmpeg

## English

PiHA LPR is a Home Assistant add-on for license plate recognition from IP cameras. It combines HTTP snapshots, RTSP, an external LPR API, MQTT, and Home Assistant actions in one web panel available through Ingress.

### Features

- multiple IP cameras with separate HTTP snapshot and RTSP settings
- live RTSP preview in the camera editor and on the dashboard
- RTSP motion detection with a per-camera threshold
- `RTSP for detection only` mode with analysis performed from HTTP snapshots
- manual `Start` and `Stop` for the RTSP worker, or automatic start after saving
- dashboard showing live RTSP or refreshed HTTP snapshots for each active camera
- continuously refreshed detection list
- MQTT with live logs and a configurable topic prefix
- whitelist entries that can automatically trigger Home Assistant services

### Home Assistant Installation

1. Open `Settings -> Add-ons -> Add-on Store`.
2. Add the repository:

   ```text
   https://github.com/plewand86/pihaalpr
   ```

3. Install the `PiHA LPR` add-on.
4. Start the add-on and open it with `Open Web UI`.

### Configuration

The `Configuration` tab includes:

- `LPR endpoint URL`: default `https://api-alpr.app4isp.pl/`
- `API key`: sent as the `key` form field
- `Minimum confidence (%)`
- `Minimum number of characters`
- `Minimum plate width (px)`
- `MQTT topic`

### Cameras

When adding a camera, provide:

- camera name
- `snapshot_url`
- `username` and `password`
- optional `rtsp_url`

RTSP uses the camera `username` and `password` fields, not credentials embedded in the URL. Available RTSP options include:

- single-frame RTSP test
- live worker preview
- connection status
- motion threshold
- `Start RTSP automatically`
- `Send to analysis via snapshot`
- `Start` and `Stop` buttons

### Dashboard

The dashboard shows all active cameras:

- if a camera has RTSP configured, it shows a live RTSP preview and current motion level
- if a camera does not use RTSP, it shows a periodically refreshed HTTP snapshot without triggering analysis

The right side shows a live list of detections with plate number, camera, confidence, and timestamp.

### Whitelist

The `Whitelist` tab lets you connect license plates with Home Assistant actions. After a matching plate is recognized, the add-on can trigger services such as:

- `cover.open_cover`
- `switch.turn_on`
- `light.turn_on`
- `automation.trigger`
- `script.turn_on`

You can also test a whitelist entry without waiting for a real detection.

### MQTT and events

The add-on publishes detections to MQTT and fires the `pihaalpr_detection` event in Home Assistant. The MQTT topic prefix is configured in the `Configuration` tab.

Example topics:

- `pihaalpr/detection`
- `pihaalpr/last_plate`
- `pihaalpr/status`

### Expected LPR API format

PiHA LPR accepts JSON responses with results under keys such as:

- `metadata`
- `results`
- `plates`
- `detections`
- `data`

Plate values can be read from fields such as:

- `recognition`
- `plate`
- `number`
- `text`

Confidence can be read from fields such as:

- `confidence`
- `score`

### Stack

- backend: FastAPI, SQLModel, APScheduler
- frontend: React, TypeScript, Vite, Tailwind CSS
- runtime: Home Assistant Ingress, MQTT, SQLite, ffmpeg

## License

MIT
