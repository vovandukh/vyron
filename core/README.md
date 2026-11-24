# Vyron Core

A service on the printer host that runs next to Moonraker and ties the devices of the Vyron ecosystem together.

## The main rule: the core never controls the printer

- **Call allow-list** ([safety.py](vyron_core/safety.py)). The core can only read state, write its own Moonraker database entries (`vyron*`) and broadcast events to clients. G-code, print start / pause / cancel, emergency stop, Klipper and host restarts, services, files and updates are blocked in code (the only file exception is moving Klipper backups, see below): such a call is never even sent. Tests verify this.
- **Local socket only**: `printer_data/comms/moonraker.sock` — no network, no new ports.
- **No dependencies**: Python standard library only, nothing is downloaded.
- **Lowest priority**: `Nice=15`, `CPUWeight=10`, idle disk I/O, at most 96 MB of memory. The service doesn't depend on Klipper or Moonraker and doesn't affect their start-up. If it crashes, the printer won't notice.
- **Doesn't change other files**: printer.cfg, moonraker.conf and nginx stay untouched.

## What it does

- **Live design sync.** Change the theme in one browser and the core tells every other open screen, which picks it up at once. The core only watches the `vyron_ui/design` entry and broadcasts `design_changed`; it never changes the theme itself.
- **Instant UI updates.** After an update the core notices the new `index.html` / `screen.html` and tells open pages to reload quietly (`ui_updated`).
- **Tidy Klipper backups.** After every `SAVE_CONFIG` Klipper drops `printer-YYYYMMDD_HHMMSS.cfg` next to the configs. The core moves these files to `backups/klipper/` under the same name. Only `server.files.move` of a file with exactly that name from the config root to that folder, plus creating the two folders, is allowed; nothing is deleted or read. Users clean up backups in Vyron Web (Configuration → Backups). Turn it off with `[backups] enabled: false` in vyron.conf.

## Install on the printer

`install/install.sh` installs the core together with Vyron. To manage it on its own:

```bash
~/vyron/core/install.sh --dry-run   # see what would be done
~/vyron/core/install.sh             # install and start
~/vyron/core/uninstall.sh           # remove the service (code, vyron.conf and the log stay)
```

- Log: `~/printer_data/logs/vyron-core.log` (or `journalctl -u vyron-core`).
- Settings (optional): copy [vyron.conf.example](vyron.conf.example) to `~/printer_data/config/vyron.conf`.

## Development

```bash
cd core
python3 -m unittest discover -s tests -v   # needs Linux/macOS (Unix socket)
python3 -m vyron_core -c ./vyron.conf.example -l ''
```

## What's next

1. Telegram: print finished or failed, Klipper stopped.
2. Anomaly watching from telemetry; auto-pause only with a separate explicit permission in `vyron.conf`, and only a pause.
3. Camera + AI with the user's own key.
