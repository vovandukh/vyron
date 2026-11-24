# @vyron/shared

Logic shared by Vyron Web and Vyron Screen, so nothing is written twice.

| Module | What it does |
|---|---|
| `moonraker/client` | WebSocket JSON-RPC client with reconnect and a half-dead-connection watchdog |
| `moonraker/api`, `db`, `backups` | HTTP file API, cache-safe config reads, quiet database reads, config backups |
| `klipper/errors` | Klipper messages (`!! Move out of range`, shutdown reasons) → category, params and a translation key |
| `klipper/toolheads`, `objects`, `eddy` | Toolhead boards, MCUs, sensors and BTT Eddy probes detected from `printer.cfg` |
| `klipper/bed`, `heat`, `tune`, `filament` | Bed shape, heating presets, live tuning, filament load / unload |
| `gcode/parser`, `gcode/model` | G-code → segments for the 3D preview, progress by byte offset |
| `theme`, `logo`, `fonts.css` | Design tokens, the Vyron logo, the bundled Montserrat font |
| `i18n`, `locales/` | Dictionaries (Ukrainian, English) and the lookup function |
| `live`, `version`, `diff`, `format` | Live updates without reloads, versions, line diff, formatting |

Import a module by its path: `import { classify } from '@vyron/shared/klipper/errors'`.
