# PiHA LPR

Home Assistant add-on do rozpoznawania tablic rejestracyjnych z kamer IP. Aplikacja laczy HTTP snapshot, RTSP, zewnetrzne API LPR, MQTT i akcje Home Assistant w jednym panelu webowym dostepnym przez Ingress.

## Co potrafi

- wiele kamer IP z osobnymi ustawieniami HTTP snapshot i RTSP
- live preview RTSP w edycji kamery oraz na dashboardzie
- detekcja ruchu na RTSP z progiem per kamera
- tryb "RTSP tylko do detekcji", a analiza przez HTTP snapshot
- reczny start i stop worker-a RTSP albo autostart po zapisie
- dashboard pokazujacy live RTSP lub odswiezany snapshot dla kazdej aktywnej kamery
- lista wykryc odswiezana na biezaco
- MQTT z logiem live i konfigurowalnym prefiksem topiku
- biala lista tablic z automatycznym wywolaniem uslugi Home Assistant

## Instalacja w Home Assistant

1. Wejdz w `Ustawienia -> Dodatki -> Sklep z dodatkami`.
2. Dodaj repozytorium:

   ```text
   https://github.com/plewand86/pihaalpr
   ```

3. Zainstaluj dodatek `PiHA LPR`.
4. Uruchom dodatek i otworz interfejs przez `Otworz interfejs webowy`.

## Konfiguracja

### Opcje dodatku

`config.yaml` add-onu udostepnia:

- `log_level`: `debug`, `info`, `warning`, `error`
- `language`: domyslnie `pl`

### Ustawienia w interfejsie

Zakladka `Konfiguracja` zawiera:

- `URL endpointu LPR`: domyslnie `https://api-alpr.app4isp.pl/`
- `Klucz API`: wysylany jako pole `key`
- `Minimalna pewnosc (%)`
- `Min. ilosc znakow`
- `Min. szerokosc tablicy (px)`
- `Topik MQTT`

## Kamery

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

## Dashboard

Dashboard pokazuje wszystkie aktywne kamery:

- jesli kamera ma RTSP, wyswietlany jest live preview RTSP i poziom ruchu
- jesli kamera nie ma RTSP, wyswietlany jest snapshot HTTP odswiezany cyklicznie bez wyzwalania analityki

Po prawej stronie widoczna jest lista wykryc z numerem tablicy, kamera, pewnoscia i czasem.

## Biala lista

Zakladka `Biala lista` pozwala powiazac tablice z akcja HA. Po rozpoznaniu tablicy mozna wywolac np.:

- `cover.open_cover`
- `switch.turn_on`
- `light.turn_on`
- `automation.trigger`
- `script.turn_on`

Dostepny jest tez test wpisu bez czekania na prawdziwe wykrycie.

## MQTT i zdarzenia

Add-on publikuje wykrycia do MQTT i wysyla zdarzenie `pihaalpr_detection` do Home Assistant. Prefiks MQTT ustawiasz w zakladce `Konfiguracja`.

Przykladowe tematy:

- `pihaalpr/detection`
- `pihaalpr/last_plate`
- `pihaalpr/status`

## Oczekiwany format API LPR

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

## Stack

- backend: FastAPI, SQLModel, APScheduler
- frontend: React, TypeScript, Vite, Tailwind CSS
- runtime: Home Assistant Ingress, MQTT, SQLite, ffmpeg

## Licencja

MIT
