# Vyron Web

The Vyron web UI for Klipper / Moonraker printers, built with Vue 3 + Pinia + Vite. Supports any number of toolheads (extruder, extruder1, …) and finds their CAN/USB boards automatically.

```bash
npm install
npm run dev      # dev server with a proxy to the printer
npm run build    # build into apps/web/dist/
```

- In dev, Vite proxies `/websocket`, `/printer`, `/server`, `/machine`, `/api` to the printer at `PRINTER_URL` (default `http://localhost:7125`). Put your printer's address in `.env.local` (not in git): `PRINTER_URL=http://<printer-ip>:7125`, or pass it as an environment variable: `PRINTER_URL=http://<printer-ip>:7125 npm run dev`.
- The printer host is resolved automatically, with no hard-coded addresses: `?host=<ip:port>` in the URL → a host saved after a manual connection (`localStorage`) → `VITE_PRINTER_HOST` → the host serving the page. The protocol follows the page (`https` → `wss`/`https`).
- The printer build (`npm run build`) **contains no demo mode**: no switch, `?demo` is ignored, no demo data in the file (the `DEMO_BUILD` flag in `src/config.js`). In development (`npm run dev`) the demo is available via the control centre switch and `?demo`.
- Local demo: `npm run dev:demo`, with a given number of toolheads: `?demo=1`, `?demo=4` (1–12, default 6).
- The source `index.html` lives in `apps/web/src/`, which is also the Vite root. The repository root on `main` holds the built files: after every push to `main` the [build-to-main](../../.github/workflows/build-to-main.yml) workflow builds the project and commits `index.html` and `screen.html` to the root.
- Single-file build (`vite-plugin-singlefile`): all JS, CSS, images and the Montserrat font are inlined into the HTML, so the web server serves one file and the UI works offline.

## GitHub Pages demo

`npm run build:demo` builds into `apps/web/dist-demo/` a version that starts straight in demo mode (`.env.demo`); a real printer can still be opened with `?host=ip:port`. The [deploy-demo](../../.github/workflows/deploy-demo.yml) workflow publishes it to the separate vyron-demo repository after every push to `main`.

## Layout

- `src/stores/`: `printerStore` (connection, Klipper state, toolheads, console, progress, demo), `designStore` (theme shared through Moonraker), `settingsStore` (local settings), `uiStore` (tabs, dialogs)
- `src/components/layout|tabs|modals|viz|ui/`: UI components
- `src/services/`: demo simulation and sounds
- Shared logic (Moonraker client, Klipper parsing, G-code, theme, translations) lives in [`@vyron/shared`](../../packages/shared)
