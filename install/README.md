# Installing Vyron

You need: a printer with Klipper, Moonraker and nginx (a standard Mainsail or Fluidd install via KIAUH).

```bash
cd ~ && git clone -b stable https://github.com/vovandukh/vyron.git
~/vyron/install/install.sh --dry-run   # see what would be done
~/vyron/install/install.sh             # install (a board without a GPU: CB1, Pi 3, SPI screen)
~/vyron/install/install.sh --gpu       # install (a board with a GPU: Pi 4/5, CM4, Orange Pi 5)
```

After the install:

| What | Address |
|---|---|
| Vyron Web | `http://printer-ip/` |
| Vyron Screen | `http://printer-ip/screen.html` |
| Mainsail / Fluidd | hidden (with `--mainsail-port 66` — at `http://printer-ip:66/`) |

## What `install.sh` does

1. **The `vyron` nginx site** on port 80. The Mainsail/Fluidd sites are disabled (hidden) —
   their files and updates stay untouched. Only the built pages (`*.html` in the repository root) are served;
   the rest of the repository isn't exposed.
2. **`[update_manager vyron]`** in `moonraker.conf` — updates through Mainsail or Vyron. The block is wrapped in
   markers; an old entry for the same folder (e.g. `[update_manager voron_ui]`) is replaced.
3. **Vyron Core** — installed by default (skip it with `--no-core`). It switches to new code by itself after an update.
4. **Printer screen** — Vyron Screen instead of KlipperScreen (via `screen.sh`; KlipperScreen is only hidden).

It doesn't touch Klipper or `printer.cfg`, never moves or heats anything. Every file it changes is backed up first
(`*.vyron-bak-DATE`). If nginx rejects the new configuration, everything is rolled back.
Moonraker isn't restarted during a print. The script is safe to run again — it only repairs what broke
(e.g. if KIAUH re-enabled Mainsail).

| Option | |
|---|---|
| `--dry-run` | change nothing, only show the steps |
| `--port N` | Vyron on its own port; Mainsail stays on 80 |
| `--mainsail-port N` | don't hide Mainsail, move it to port N (e.g. 66) |
| `--no-updates` | don't add the Update Manager entry |
| `--no-core` | don't install the Vyron Core service |
| `--no-screen` | leave the printer screen alone (KlipperScreen stays) |
| `--gpu` / `--no-gpu` | GPU acceleration for the printer screen (Pi 4/5, CM4, Orange Pi 5) or none (CB1, Pi 3, SPI screens — the default). The choice is remembered |
| `--screen-app web` | **experimental**, only with `--gpu`: the full Vyron Web (with 3D) on the printer screen instead of Vyron Screen (Pi 5, Orange Pi 5). Back: `--screen-app screen`. The choice is remembered |
| `--stable` / `--dev` | update channel: tested releases (`stable` branch) or every change (`main` branch). Switches the repository to that branch and updates the Update Manager entry. Without it — the current branch's channel |

## Uninstall

```bash
~/vyron/install/uninstall.sh --dry-run
~/vyron/install/uninstall.sh            # the repository folder stays
~/vyron/install/uninstall.sh --purge    # and delete the folder
```

Moves Mainsail back to port 80 (re-enables it), removes the `vyron` site, the `moonraker.conf` entry and the Vyron Core service.

## Vyron Screen on the printer screen (instead of KlipperScreen)

```bash
~/vyron/install/screen.sh --dry-run   # see the plan
~/vyron/install/screen.sh             # put Vyron Screen on the screen
~/vyron/install/screen.sh --remove    # bring KlipperScreen back
```

`install.sh` runs this step itself; you need it separately only to switch the screen. The screen gets a local nginx site
on `127.0.0.1:7136` (unreachable from the network, Mainsail untouched). It installs Chromium (if missing) and the
`vyron-screen` service, which takes the display and touch settings from KlipperScreen. KlipperScreen is only disabled;
if Vyron Screen doesn't start, KlipperScreen comes back automatically.

On a 480×320 screen (TFT35) `screen.sh` also installs the **boot animation** — the `vyron-splash` service
(`install/splash/splash.py`, straight to the framebuffer): the Vyron logo from power-on until Vyron Screen starts,
which then continues it with its own launch animation. `--remove` removes it too.
