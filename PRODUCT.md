# Product

<!-- impeccable:product-schema 1 -->

One record for all of Vyron: `apps/web` (Vyron Web) and `apps/screen` (Vyron Screen) inherit it. The differences between them are in "Capabilities and Constraints".

## Platform

web

## Users

The owner of a self-built Klipper 3D printer (Voron, StealthChanger and other toolchangers, delta) who already knows Mainsail / Fluidd / KlipperScreen and can SSH into the printer.

- **At a PC, laptop, tablet or phone (Vyron Web):** starts and watches prints, tweaks parameters on the fly, calibrates, edits the config, deals with Klipper errors.
- **At the printer (Vyron Screen):** taps a small resistive screen (TFT35, 480×320): heat, move, start a file, tune during a print, see what went wrong.

Secondary audience — testers on other hardware (BTT CB1, Raspberry Pi, tablet hosts, delta, DSI screens) who bring bugs from real printers.

## Product Purpose

An open UI ecosystem for Klipper: a web UI and a printer screen app with one design, plus a small host service (Vyron Core). No subscriptions or cloud — everything runs on the printer through Moonraker. The goal is a fully open alternative to closed or paid printer interfaces.

Success: a person installs Vyron with one command, uses it instead of Mainsail + KlipperScreen and doesn't want to go back — and if they do, one script takes them back.

## Positioning

- **One design and one language on every screen, synced live.** Theme, glass and language are stored in the Moonraker database; Core broadcasts the change and the browser and printer screen update at once. Quiet UI updates without reloads.
- **Klipper errors in plain words:** what happened / why / what to do. Hints must be technically accurate — they are checked against real Klipper on real hardware.
- **Safety and openness:** GPL-3.0, Moonraker API only, printing doesn't depend on the UI (the UI freezes — the print goes on). Core controls nothing (an allow-list: only reading and its own database entries). Mainsail/Fluidd/KlipperScreen are only hidden and come back with `uninstall.sh`.

## Operating Context

- A printer with Klipper + Moonraker; Vyron is served by nginx on `:80`, Mainsail is hidden (optionally on another port).
- Host boards from weak GPU-less ones (BTT CB1, Pi 3 / Zero 2) to Pi 4/5, CM4, Orange Pi 5.
- Screen runs in a kiosk browser (Chromium) on the printer screen instead of KlipperScreen; resistive touch — scrolling by dragging, not gestures.
- Web — on desktop, tablet, phone, foldable phone (Fold mode, two panes when unfolded).
- Updates through Moonraker Update Manager; `stable` (releases) and `dev` (`main`) channels.
- User rituals: watching prints remotely, calibrating (QGL, Z-tilt, bed mesh), editing `printer.cfg`, browsing history, turning on the camera.

## Capabilities and Constraints

- **Klipper drives the hardware.** Vyron shows state and passes commands on. Dangerous actions ask for confirmation and are blocked during a print.
- **User macros first** (`LOAD_FILAMENT`, `M600` etc.); our own logic only as a macro template. Macro names as in KlipperScreen, `action:prompt` as in Mainsail.
- **Screen is light, Web is full.** Screen on CB1 + TFT35: no heavy 3D, blur, shadows or looping animations; the bundled Montserrat font; sizes in rem = 1/48 of the width (scales to 800×480 / 1024×600); a budget of ~9 % CPU while printing. Web: full features, 3D (print preview, bed mesh, real bed shape), effects, themes; WebGL has a fallback.
- Shared logic (Moonraker client, Klipper errors, themes, translations, logo) lives in `@vyron/shared` and isn't duplicated between Web and Screen.
- Stack: Vue 3 + Vite, npm workspaces; Web and Screen build into single-file `index.html` / `screen.html`. Core — Python stdlib, Py 3.7+.
- Demo mode (`?demo`) works without a printer; the demo code never reaches the printer build.
- Not there yet (parity with competitors in progress): temperature graphs, `action:prompt`, exclude object, print queue, G-code upload, Spoolman, multiple printers, authentication. The camera is in dev.

## Brand Commitments

- The name is **Vyron** (the ecosystem: Vyron Web, Vyron Screen, Vyron Core). The VYRON word mark in the header; the logo is the VD monogram (a D silhouette with a cut-out V), `packages/shared/src/logo.js`, following `--brand`.
- Languages: English and Ukrainian; one language shared by Web and Screen; the default follows the system language.
- Voice: plain language, honest about limits ("early project", what is tested and what isn't). Technical accuracy matters more than a reassuring tone.
- The user's theme colour is free, but red (`--red`) stays semantic — only errors and danger.

## Evidence on Hand

- Public demo: https://vovandukh.github.io/vyron-demo/ (runs in the browser without a printer).
- Tested on several of the author's printers (Voron, CAN toolheads, BTT CB1 + TFT35). Measurements: Screen ~9 % CPU on a CB1 while printing; Web on the same screen ~34 % without 3D / ~88 % with software WebGL.
- **None yet:** reviews, user counts, case studies, press, benchmarks against competitors. Don't invent them.

## Product Principles

1. **The printer matters more than the interface.** Nothing that could affect a print, heat or move without explicit confirmation; the UI may crash, the print may not.
2. **One system, two screens.** Every Web decision has a Screen counterpart (or a deliberately lighter version) with the same language and theme.
3. **Explain, don't just show.** State and errors come as "what / why / what to do", true to Klipper's real behaviour.
4. **Respect weak hardware.** Screen fits the CB1 budget; effects only where there is a GPU.
5. **Reversible and open.** Everything installs with one command, rolls back with one script and never locks a person into Vyron.

## Accessibility & Inclusion

- Screen: resistive touch on 480×320 — large touch targets, drag scrolling, an on-screen keyboard, readable from a distance next to the printer.
- Colour is never the only carrier of meaning (themes change, `--red` is semantic).
- Two languages (en/uk) are required for every new text.
