#!/usr/bin/env bash
# Installs Vyron Core as a systemd service.
#
#   ~/vyron/core/install.sh            — install and start
#   ~/vyron/core/install.sh --dry-run  — only show what would be done
#
# What it does: creates /etc/systemd/system/vyron-core.service and starts the service.
# What it does NOT do: touch Klipper, Moonraker, printer.cfg, moonraker.conf or nginx. Downloads nothing
# from the internet — the core uses only the Python standard library.
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="${SUDO_USER:-$(id -un)}"
USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
DATA="${PRINTER_DATA:-$USER_HOME/printer_data}"
UNIT=/etc/systemd/system/vyron-core.service

say() { printf '\033[1m%s\033[0m\n' "$*"; }
run() { if [ $DRY = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }

say "Vyron Core — install"
echo "  user:         $USER_NAME"
echo "  core code:    $CORE_DIR"
echo "  printer_data: $DATA"

if [ "$(id -u)" = 0 ] && [ -z "${SUDO_USER:-}" ]; then
  echo "Run as a regular user (sudo is asked for when needed)." >&2; exit 1
fi
command -v python3 >/dev/null || { echo "python3 not found." >&2; exit 1; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' \
  || { echo "Python 3.7 or newer is required." >&2; exit 1; }
[ -d "$DATA" ] || { echo "$DATA not found. Set the path: PRINTER_DATA=/path $0" >&2; exit 1; }
[ -S "$DATA/comms/moonraker.sock" ] \
  || echo "  Note: $DATA/comms/moonraker.sock doesn't exist yet — the core connects as soon as Moonraker creates it."

say "Checking the core code"
(cd "$CORE_DIR" && python3 -c 'import vyron_core.app, vyron_core.__main__') || { echo "The core code doesn't load." >&2; exit 1; }

say "systemd service: $UNIT"
TMP="$(mktemp)"
sed -e "s|@USER@|$USER_NAME|g" -e "s|@CORE_DIR@|$CORE_DIR|g" -e "s|@DATA@|$DATA|g" "$CORE_DIR/vyron-core.service" > "$TMP"
if [ $DRY = 1 ]; then sed 's/^/  | /' "$TMP"; fi
run sudo install -m 644 "$TMP" "$UNIT"
rm -f "$TMP"
run sudo systemctl daemon-reload
run sudo systemctl enable --now vyron-core.service

if [ $DRY = 0 ]; then
  sleep 2
  if systemctl is-active --quiet vyron-core.service; then
    say "Done: Vyron Core is running."
  else
    echo "The service didn't start. Log: journalctl -u vyron-core -n 50" >&2; exit 1
  fi
fi
echo "  log:       $DATA/logs/vyron-core.log"
echo "  uninstall: $CORE_DIR/uninstall.sh"
