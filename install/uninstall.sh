#!/usr/bin/env bash
# Vyron — uninstall. Brings the printer back to its "before Vyron" state:
#   - removes the "vyron" nginx site, moves Mainsail/Fluidd back to their port (80) and the default nginx site if it was disabled;
#   - removes [update_manager vyron] from moonraker.conf (with a backup of the file);
#   - stops and removes the Vyron Core service if present.
# Doesn't delete the repository folder (only with --purge). Klipper and printer.cfg are left alone.
#
#   ~/vyron/install/uninstall.sh [--dry-run] [--purge]
set -euo pipefail

DRY=0
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib.sh
. "$REPO/install/lib.sh"

say "Vyron — uninstall$([ $DRY = 1 ] && echo ' (dry-run: changing nothing)')"
preflight

# ---------- Vyron Core ----------
say "1. Vyron Core"
if [ -f /etc/systemd/system/vyron-core.service ]; then
  if [ -f "$REPO/core/uninstall.sh" ]; then
    run bash "$REPO/core/uninstall.sh"
  else
    run sudo systemctl disable --now vyron-core.service
    run sudo rm -f /etc/systemd/system/vyron-core.service
    run sudo systemctl daemon-reload
  fi
  ok "vyron-core service removed"
else
  info "service not installed"
fi

# ---------- screen: bring KlipperScreen back ----------
if [ -f /etc/systemd/system/vyron-screen.service ] || [ -e /etc/nginx/sites-enabled/vyron-screen ]; then
  if [ $DRY = 1 ]; then bash "$REPO/install/screen.sh" --remove --dry-run; else bash "$REPO/install/screen.sh" --remove; fi
fi

# ---------- nginx ----------
say "2. nginx site"
SITE_AV=/etc/nginx/sites-available/vyron
SITE_EN=/etc/nginx/sites-enabled/vyron
MOVED="$(state_get MOVED)"
DISABLED="$(state_get DISABLED)"

# No state record (manual install): Mainsail/Fluidd not on 80 while the vyron site exists — move back to 80
if [ -z "$MOVED" ] && [ -e "$SITE_EN" ] && listens_on "$(readlink -f "$SITE_EN")" 80; then
  for f in /etc/nginx/sites-enabled/*; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = vyron ] && continue
    real="$(readlink -f "$f")"
    is_web_ui "$real" || continue
    p="$(listen_port "$real")"
    [ -n "$p" ] && [ "$p" != 80 ] && MOVED="$MOVED $real|80|$p"
  done
fi

UNDO=()
if [ -e "$SITE_EN" ] || [ -e "$SITE_AV" ]; then
  info "removing $SITE_EN and $SITE_AV (backup: $(backup_name "$SITE_AV"))"
  if [ $DRY = 0 ]; then
    if [ -f "$SITE_AV" ]; then
      b="$(backup_name "$SITE_AV")"; sudo mv "$SITE_AV" "$b"
      UNDO+=("sudo mv $(printf %q "$b") $(printf %q "$SITE_AV")")
    fi
    if [ -L "$SITE_EN" ] || [ -e "$SITE_EN" ]; then
      sudo rm -f "$SITE_EN"; UNDO+=("sudo ln -sfn $(printf %q "$SITE_AV") $(printf %q "$SITE_EN")")
    fi
  fi
else
  info "no vyron site"
fi

for m in $MOVED; do
  file="${m%%|*}"; rest="${m#*|}"; from="${rest%%|*}"; to="${rest#*|}"
  [ -f "$file" ] || { warn "$file not found — skipping"; continue; }
  info "$(basename "$file"): port $to → $from"
  if [ $DRY = 0 ]; then
    b="$(backup_name "$file")"; sudo cp -a "$file" "$b"
    UNDO+=("sudo cp -a $(printf %q "$b") $(printf %q "$file")")
    sudo sed -i -E "s/^([[:space:]]*listen[[:space:]]+(\[::\]:)?)$to([[:space:];])/\1$from\3/" "$file"
  fi
done
for d in $DISABLED; do
  link="${d%%|*}"; target="${d#*|}"
  [ -f "$target" ] || continue
  info "restoring the default nginx site $link"
  if [ $DRY = 0 ]; then sudo ln -sfn "$target" "$link"; UNDO+=("sudo rm -f $(printf %q "$link")"); fi
done

if [ $DRY = 0 ]; then
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
    ok "nginx reloaded"
  else
    warn "nginx rejected the configuration — restoring it as it was:"
    sudo nginx -t 2>&1 | sed 's/^/      /' || true
    for ((i=${#UNDO[@]}-1; i>=0; i--)); do eval "${UNDO[$i]}"; done
    die "The nginx site was not changed. The remaining steps were skipped."
  fi
  if [ "$(state_get HOME_OX)" = 1 ]; then sudo chmod o-x "$USER_HOME"; fi
fi

# ---------- moonraker.conf ----------
say "3. Update Manager (moonraker.conf)"
MR_CHANGED=0
if grep -q "^$MARK_PREFIX" "$MR_CONF"; then
  b="$(backup_name "$MR_CONF")"
  info "removing [update_manager vyron] (backup: $b)"
  if [ $DRY = 0 ]; then
    cp -a "$MR_CONF" "$b"
    NEW="$(mktemp)"; strip_block "$MR_CONF" | trim_tail > "$NEW"; cat "$NEW" > "$MR_CONF"; rm -f "$NEW"
    MR_CHANGED=1
  fi
else
  info "no entry"
fi
ASVC="$DATA/moonraker.asvc"
if [ -f "$ASVC" ] && grep -qx "vyron-core" "$ASVC"; then
  info "removing vyron-core from moonraker.asvc"
  if [ $DRY = 0 ]; then sed -i '/^vyron-core$/d' "$ASVC"; MR_CHANGED=1; fi
fi
if [ $MR_CHANGED = 1 ]; then
  if printer_busy; then
    warn "A print is running — not restarting Moonraker. After the print: sudo systemctl restart moonraker"
  else
    sudo systemctl restart moonraker && ok "Moonraker restarted"
  fi
fi

[ $DRY = 1 ] || rm -f "$STATE"

# ---------- folder ----------
if [ $PURGE = 1 ]; then
  say "4. Folder $REPO"
  run rm -rf "$REPO"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Done$([ $DRY = 1 ] && echo ' (dry-run — nothing changed)')"
info "Mainsail is back at http://${IP:-<printer IP>}/"
[ $PURGE = 1 ] || info "The folder $REPO is still there — delete it: rm -rf $REPO"
