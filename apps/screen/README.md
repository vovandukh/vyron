# Vyron Screen

The touchscreen app for the printer. The main target is the SPI TFT35 (480×320); on 800×480 and 1024×600 HDMI screens the same layout scales proportionally (1rem = 1/48 of the screen width).

Logic is shared with Vyron Web (`@vyron/shared`): the Moonraker client, Klipper error parsing, translations and the theme. The screen reads its theme and language from the Moonraker database, so a design changed in the browser applies here too — instantly when Vyron Core is running.

## Light on weak graphics

The SPI screen is drawn by the CPU, so there is no WebGL, blur, shadows or endless animations; animations use transform and opacity only. The G-code preview is a pseudo-3D view on a plain 2D canvas. The build is a single ~370 KB file; on a CB1 the screen takes ~9 % CPU while printing.

## What it does

- Top bar with the printer state and STOP (with confirmation), reachable from every page.
- Printing: G-code preview or progress ring, file, layer, time left, temperatures, pause / resume / cancel, live tuning (Z offset, speed, flow, fan).
- Files with slicer thumbnails, heating with material presets, motion (home, QGL / Z-Tilt, jog), filament load / unload.
- Klipper errors explained in plain words, with a restart button.
- Settings: Wi‑Fi, theme, language, updates, system (restart / reboot / shutdown), config backups.
- Boot and launch animation: continues the printer's boot animation (`install/splash`) seamlessly into the UI.

## Development

```bash
npm run dev:screen        # http://localhost:5200 — with a printer via the proxy (PRINTER_URL in apps/screen/.env.local)
# http://localhost:5200/?demo&state=printing|paused|idle|shutdown — demo without a printer
# http://localhost:5200/demo/tft35.html — the demo in a TFT35 device frame
npm run build:screen      # apps/screen/dist/index.html
```

After a push to `main`, CI puts the build into the repository root as `screen.html`. On the printer it opens at `http://<printer>/screen.html`.
