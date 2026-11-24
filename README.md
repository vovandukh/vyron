# Vyron

[Українська](README.uk.md) · **English**

An open ecosystem for Klipper 3D printers: a web UI and a printer touchscreen app with one shared design,
plus a small helper service on the host. No subscriptions, no cloud — everything runs on the printer through Moonraker.

**[Live demo](https://vovandukh.github.io/vyron-demo/)** — runs in the browser, no printer needed.

> **Beta (0.5.0-beta).** Tested on the author's printers (Voron, CAN toolheads, BTT TFT35). Other hardware may
> surface quirks — please report them in [Issues](https://github.com/vovandukh/vyron/issues).
> Mainsail, Fluidd and KlipperScreen are never removed, so you can go back at any time.

| Part | Folder | What it is |
|---|---|---|
| **Vyron Web** | [`apps/web`](apps/web) | Web UI for desktop, tablet and phone (Vue 3) |
| **Vyron Screen** | [`apps/screen`](apps/screen) | Printer touchscreen app (480×320 TFT35 for now) |
| **Vyron Core** | [`core`](core) | Host service: pushes theme changes and new versions to every screen instantly |
| **@vyron/shared** | [`packages/shared`](packages/shared) | Logic shared by Web and Screen: Moonraker client, Klipper errors, themes, translations |
| **Install** | [`install`](install) | `install.sh` / `uninstall.sh` |

## What makes it different

- **Klipper errors in plain words.** `!! MCU 'EBBCan' shutdown: Timer too close` becomes a clear title, what it means and what to check — with a one-tap restart.
- **One design, every screen.** Theme and language live in Moonraker's database: change them in the browser and the printer screen follows instantly.
- **3D print preview** with the real bed shape (rectangular, round delta), per-tool colours and live progress.
- **Any number of toolheads.** CAN/USB toolboards, their MCUs, sensors and BTT Eddy probes are detected from `printer.cfg`.
- **Light on weak boards.** Vyron Screen takes ~9 % CPU on a BTT CB1 while printing; the boot animation flows seamlessly into the UI.
- **Quiet updates.** A new version swaps in without a reload flash while nobody is touching the screen.
- **Safe by design.** Klipper drives the hardware; the UI only talks to Moonraker, and Vyron Core has an allow-list that can't move, heat or print.

## Install

**You need:** a printer with Klipper, Moonraker and Mainsail or Fluidd (a regular KIAUH install).
Run the commands on the printer over SSH (e.g. `ssh pi@192.168.1.50` — your login and IP).

```bash
cd ~ && git clone -b stable https://github.com/vovandukh/vyron.git
~/vyron/install/install.sh --dry-run   # see what would be done (changes nothing)
```

Then one of two commands, depending on the host board:

| Board | Command |
|---|---|
| **No GPU:** BTT CB1, Raspberry Pi 3 / Zero 2, any board with an SPI screen (TFT35 etc.) | `~/vyron/install/install.sh` |
| **With a GPU:** Raspberry Pi 4 / 5, CM4, Orange Pi 5 (RK3588) — with a DSI or HDMI screen | `~/vyron/install/install.sh --gpu` |

The difference only matters for the printer screen: with `--gpu` the browser draws on the GPU and the CPU stays with Klipper.
Not sure — install without `--gpu`, it works on any board. If the screen is black or flickers with `--gpu`, run
`~/vyron/install/install.sh --no-gpu`. Vyron Web in a desktop or phone browser isn't affected.

**Experimental — the full Vyron Web (with 3D) on the printer screen** instead of Vyron Screen. Only for powerful boards
with a GPU (Raspberry Pi 5, Orange Pi 5) and a 5″ or larger screen:

```bash
~/vyron/install/install.sh --gpu --screen-app web      # full web UI on the screen
~/vyron/install/install.sh --screen-app screen         # back to Vyron Screen
```

Without `--gpu` the script refuses: on a board without a GPU the web UI with 3D takes almost the whole CPU (88 % on a CB1),
and Klipper needs it. If you try it, please tell us in Issues how it runs on your board.

The script may ask for your password (for `sudo`). After the install:

| What | Address |
|---|---|
| Vyron Web | `http://printer-ip/` |
| Vyron Screen | on the printer screen instead of KlipperScreen; in a browser — `http://printer-ip/screen.html` |

Mainsail/Fluidd and KlipperScreen are only hidden. If Vyron Screen fails to start on the screen, the script brings
KlipperScreen back by itself.

- Want Mainsail alongside — `--mainsail-port 66` (it will live at `http://printer-ip:66/`).
- Leave the screen alone — `--no-screen`.
- The first run downloads Chromium for the screen (~100 MB, a few minutes).

The script doesn't touch Klipper or `printer.cfg`, never moves or heats the printer. Every file it changes is backed up first
(`*.vyron-bak-DATE`). Moonraker isn't restarted during a print. All options are in [install/README.md](install/README.md).

## Updates and channels

Update through the Update Manager: in Vyron → Settings → Updates → `vyron` (or in Mainsail/Fluidd).

| Channel | Branch | What you get |
|---|---|---|
| **stable** | `stable` | Tested releases ([Releases](https://github.com/vovandukh/vyron/releases)). For everyday use. |
| **dev** | `main` | Every change right after it builds. For those who want to test new things and accept bugs. |

Switch the channel:

```bash
~/vyron/install/install.sh --dev      # to dev
~/vyron/install/install.sh --stable   # back to stable
```

## Uninstall

Puts everything back as it was (Mainsail at `http://printer-ip/` again, KlipperScreen on the screen):

```bash
~/vyron/install/uninstall.sh --purge
```

## How it works

Web and Screen talk to the printer only through the Moonraker API — like Mainsail and Fluidd. Klipper runs the print itself,
so if the UI freezes or crashes, the print isn't affected. Shared settings (theme, glass transparency, language) live in the
Moonraker database on the printer, so a theme changed in the browser applies to the printer screen at once.

Vyron Core connects to Moonraker as an agent and only notifies clients about changes. It has an allow-list of calls:
it can't control printing, heating, motion or files.

## Development

npm workspaces: one command in the root installs the dependencies of every JS part.

```bash
npm install
npm run dev          # Vyron Web with a proxy to the printer (PRINTER_URL in apps/web/.env.local)
npm run build        # Web → apps/web/dist/
npm run build:screen # Screen → apps/screen/dist/
npm run build:demo   # demo → apps/web/dist-demo/
python3 -m unittest discover -s core/tests   # Vyron Core tests
```

After every push to `main`, CI builds Web and Screen into the single-file `index.html` and `screen.html` in the repository
root — nginx on the printer serves them. Releases to `stable` are manual: Actions → **Release to stable**
(tags `vX`, moves `stable` and creates a GitHub Release).

The code is written with the help of Claude (AI); the idea, design, decisions and hardware testing are the author's.

## License

[GPL-3.0](LICENSE) — like Mainsail. You may use, modify and share it; derivative projects must stay open under the same license.
