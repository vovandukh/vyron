#!/usr/bin/env bash
# Vyron Screen on the printer screen instead of KlipperScreen.
#
#   ~/vyron/install/screen.sh             — put Vyron Screen on the screen
#   ~/vyron/install/screen.sh --dry-run   — only show what would be done
#   ~/vyron/install/screen.sh --remove    — bring KlipperScreen back
#   ~/vyron/install/screen.sh --gpu       — a board with a GPU (Raspberry Pi 4/5, CM4…): browser acceleration
#   ~/vyron/install/screen.sh --no-gpu    — no acceleration (CB1, Pi 3, SPI screens; the default)
#   ~/vyron/install/screen.sh --gpu --app web — EXPERIMENTAL: the full Vyron Web (with 3D) on the screen,
#                                               only for boards with a GPU (Pi 5, Orange Pi 5); --app screen — back
#
# What it does:
#   1. A local nginx site "vyron-screen" on 127.0.0.1:7136 (for the screen only; unreachable from the network,
#      Mainsail and the vyron site are left alone). No separate install.sh needed for this.
#   2. The Chromium browser (apt) if it isn't there yet.
#   3. The vyron-screen service: Chromium full-screen with the same display and touch settings as
#      KlipperScreen. KlipperScreen is only disabled (not removed); if Vyron Screen doesn't
#      start, KlipperScreen comes back automatically.
# Doesn't touch Klipper, Moonraker or printer.cfg, doesn't move or heat the printer.
set -euo pipefail

DRY=0
REMOVE=0
LPORT=7136
GPU=""
APP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --remove|--uninstall) REMOVE=1 ;;
    --gpu) GPU=1 ;;
    --no-gpu) GPU=0 ;;
    --app) APP="${2:-}"; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib.sh
. "$REPO/install/lib.sh"

UNIT=/etc/systemd/system/vyron-screen.service
SITE_AV=/etc/nginx/sites-available/vyron-screen
SITE_EN=/etc/nginx/sites-enabled/vyron-screen
KS=KlipperScreen.service
has_ks() { has_unit "$KS"; }
SPLASH_UNIT=/etc/systemd/system/vyron-splash.service
# The boot animation is built for a TFT 480×320 (16 bit) — look for such a framebuffer
splash_fb() {
  local f
  for f in /sys/class/graphics/fb*; do
    [ -e "$f/virtual_size" ] || continue
    if [ "$(cat "$f/virtual_size")" = "480,320" ] && [ "$(cat "$f/bits_per_pixel")" = 16 ]; then echo "/dev/$(basename "$f")"; return; fi
  done
}

# ---------- bring KlipperScreen back ----------
if [ $REMOVE = 1 ]; then
  say "Vyron Screen — bringing KlipperScreen back$([ $DRY = 1 ] && echo ' (dry-run)')"
  preflight
  if [ -f "$UNIT" ]; then
    run sudo systemctl disable --now vyron-screen.service
    run sudo rm -f "$UNIT"
    run sudo systemctl daemon-reload
    run sudo systemctl reset-failed vyron-screen.service || true
    ok "vyron-screen service removed"
  fi
  if [ -f "$SPLASH_UNIT" ]; then
    run sudo systemctl disable --now vyron-splash.service
    run sudo rm -f "$SPLASH_UNIT"
    run sudo systemctl daemon-reload
    ok "boot animation removed"
  fi
  if has_ks; then
    run sudo systemctl enable "$KS"
    run sudo systemctl restart "$KS"
    ok "KlipperScreen enabled"
  fi
  if [ -e "$SITE_EN" ] || [ -e "$SITE_AV" ]; then
    run sudo rm -f "$SITE_EN" "$SITE_AV"
    if [ $DRY = 0 ]; then sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx; fi
    ok "local vyron-screen site removed"
  fi
  state_set SCREEN 0
  info "Chromium stays installed. To remove it: sudo apt remove chromium"
  exit 0
fi

# ---------- install ----------
say "Vyron Screen — onto the printer screen$([ $DRY = 1 ] && echo ' (dry-run: changing nothing)')"
preflight
[ -f "$REPO/screen.html" ] || die "$REPO has no screen.html — update the repository (git pull)."
has_ks || die "KlipperScreen not found. Display and touch settings are taken from it — install KlipperScreen first (KIAUH) and make sure the screen works."
[ -x /usr/bin/xinit ] || die "xinit not found (the xinit package)."
UID_N="$(id -u "$USER_NAME")"

# GPU and the app on the screen: from the options, otherwise as in the previous install
[ -n "$GPU" ] || GPU="$(state_get SCREEN_GPU)"
[ "$GPU" = 1 ] || GPU=0
[ -n "$APP" ] || APP="$(state_get SCREEN_APP)"
case "$APP" in web) PAGE=index.html ;; ""|screen) APP=screen; PAGE=screen.html ;; *) die "--app: screen or web." ;; esac
if [ "$APP" = web ] && [ "$GPU" != 1 ]; then
  die "The full Vyron Web on the screen needs a GPU (--gpu): without one the 3D scene and glass take the CPU
         that Klipper needs (88% of the CPU on a CB1). For this board use Vyron Screen: install.sh --screen-app screen"
fi
[ -f "$REPO/$PAGE" ] || die "$REPO has no $PAGE — update the repository (git pull)."
URL="http://127.0.0.1:$LPORT/$PAGE"
[ "$APP" = web ] && warn "EXPERIMENTAL: the full Vyron Web will be on the screen. If it lags or heats up — screen.sh --app screen"

info "screen:       $(for f in /sys/class/graphics/fb*; do [ -e "$f/name" ] && printf '%s(%s %s) ' "$(basename "$f")" "$(cat "$f/name")" "$(cat "$f/virtual_size" 2>/dev/null)"; done)"
info "memory:       $(free -m | awk '/^Mem:/{print $2" MB, "$7" MB free"}')"
info "page:         $URL"

# Groups KlipperScreen runs with (display, touch, shutdown access) — we use the same ones
KS_USER="$(systemctl show -p User --value "$KS" 2>/dev/null || true)"
KS_GROUPS="$(systemctl show -p SupplementaryGroups --value "$KS" 2>/dev/null || true)"
[ -z "$KS_USER" ] || [ "$KS_USER" = "$USER_NAME" ] || warn "KlipperScreen runs as $KS_USER, while Vyron Screen will run as $USER_NAME"

# 1. nginx
say "1. Local nginx site (127.0.0.1:$LPORT)"
if port_busy "$LPORT" && [ ! -e "$SITE_EN" ]; then die "Port $LPORT is already used by another program."; fi
CONF="$(mktemp)"; UNITF="$(mktemp)"
trap 'rm -f "$CONF" "$UNITF"' EXIT
sed -e "s|@PORT@|$LPORT|g" -e "s|@ROOT@|$REPO|g" -e "s|@MOONRAKER_PORT@|$MR_PORT|g" -e "s|@HOME@|/$PAGE|g" "$REPO/install/nginx-vyron-screen.conf" > "$CONF"
if [ $DRY = 1 ]; then
  info "will create $SITE_AV (listening on 127.0.0.1:$LPORT only)"
else
  HAD=0; [ -f "$SITE_AV" ] && HAD=1 && sudo cp -a "$SITE_AV" "$(backup_name "$SITE_AV")"
  sudo install -m 644 "$CONF" "$SITE_AV"
  sudo ln -sfn "$SITE_AV" "$SITE_EN"
  case "$(stat -c %A "$USER_HOME")" in *[xt]) ;; *) sudo chmod o+x "$USER_HOME"; state_set HOME_OX 1 ;; esac
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
  else
    sudo nginx -t 2>&1 | sed 's/^/      /' || true
    if [ $HAD = 1 ]; then sudo cp -a "$(backup_name "$SITE_AV")" "$SITE_AV"; else sudo rm -f "$SITE_AV" "$SITE_EN"; fi
    die "nginx rejected the configuration — nothing changed."
  fi
  for i in 1 2 3 4 5; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"; [ "$code" = 200 ] && break; sleep 1
  done
  [ "$code" = 200 ] || die "The page $URL doesn't open (code $code)."
  ok "the page opens"
  # Moonraker may have just restarted (install.sh) — wait up to 30 s
  for i in $(seq 1 15); do
    api="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$LPORT/server/info" || true)"; [ "$api" = 200 ] && break; sleep 2
  done
  if [ "$api" = 200 ]; then ok "Moonraker answers"
  else warn "Moonraker answers with code $api via the local site — the screen connects as soon as Moonraker is up"; fi
fi

# 2. Chromium
say "2. Browser"
if command -v chromium >/dev/null || command -v chromium-browser >/dev/null; then
  ok "Chromium is already installed"
else
  FREE_MB="$(df -m / | awk 'NR==2{print $4}')"
  [ "$FREE_MB" -gt 600 ] || die "Low disk space: $FREE_MB MB free, Chromium needs ~600 MB."
  # On a fresh system the apt package lists are still empty — update them first, then look for Chromium
  if ! has_pkg chromium && ! has_pkg chromium-browser; then
    if [ $DRY = 1 ]; then
      info "the apt package lists aren't updated yet — the install will run apt-get update and install chromium"
    else
      info "updating package lists (apt-get update)…"
      sudo apt-get update -qq || warn "apt-get update failed — trying anyway"
    fi
  fi
  PKG=chromium
  has_pkg chromium || PKG=chromium-browser
  if [ $DRY = 0 ] && ! has_pkg "$PKG"; then
    die "The system repositories have no Chromium (the chromium package). Check: apt-cache policy chromium"
  fi
  info "installing $PKG (~100 MB download, a few minutes)"
  run sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$PKG" x11-xserver-utils x11-utils
fi

# 3. service
say "3. vyron-screen service (instead of KlipperScreen)"
info "browser GPU: $([ $GPU = 1 ] && echo 'on (--gpu)' || echo 'off — the CPU draws (--gpu if the board has a GPU)')"
GROUPS_LINE=""; [ -n "$KS_GROUPS" ] && GROUPS_LINE="SupplementaryGroups=$KS_GROUPS"
sed -e "s|@USER@|$USER_NAME|g" -e "s|@UID@|$UID_N|g" -e "s|@GROUPS@|$GROUPS_LINE|" \
    -e "s|@KIOSK@|$REPO/install/screen-kiosk.sh|g" -e "s|@URL@|$URL|g" -e "s|@GPU@|$GPU|g" "$REPO/install/vyron-screen.service" > "$UNITF"
if [ $DRY = 1 ]; then
  info "$UNIT will be:"; sed 's/^/      | /' "$UNITF"
  info "KlipperScreen: will be disabled (not removed), Vyron Screen starts on the screen"
else
  chmod +x "$REPO/install/screen-kiosk.sh"
  sudo install -m 644 "$UNITF" "$UNIT"
  sudo systemctl daemon-reload
  sudo systemctl disable "$KS" >/dev/null 2>&1 || true
  sudo systemctl enable vyron-screen.service >/dev/null 2>&1
  sudo systemctl stop "$KS" || true
  sudo systemctl reset-failed vyron-screen.service 2>/dev/null || true
  sudo systemctl start vyron-screen.service
  state_set SCREEN 1
  state_set SCREEN_GPU "$GPU"
  state_set SCREEN_APP "$APP"
  info "waiting for the browser to start (up to 40 s)…"
  up=0
  for i in $(seq 1 20); do
    sleep 2
    if systemctl is-active --quiet vyron-screen.service && pgrep -u "$USER_NAME" -f 'vyron-screen' >/dev/null; then up=$((up+1)); [ $up -ge 4 ] && break; else up=0; fi
  done
  if [ $up -ge 4 ]; then
    ok "Vyron Screen is running on the screen"
  else
    warn "Vyron Screen didn't start — bringing KlipperScreen back. Log:"
    journalctl -u vyron-screen -n 25 --no-pager 2>/dev/null | sed 's/^/      /' || true
    sudo systemctl disable --now vyron-screen.service >/dev/null 2>&1 || true
    sudo systemctl enable "$KS" >/dev/null 2>&1 || true
    sudo systemctl start "$KS" || true
    state_set SCREEN 0
    die "KlipperScreen restored. Please send the log above to the developers."
  fi
fi

# 4. Boot animation (TFT 480×320 only: the frames are built for it)
say "4. Boot animation"
SFB="$(splash_fb)"
if [ -z "$SFB" ]; then
  info "the screen isn't 480×320 — skipping the boot animation"
elif [ $DRY = 1 ]; then
  info "vyron-splash service: the animation on $SFB from power-on until Vyron Screen starts"
else
  SPLASHF="$(mktemp)"
  sed -e "s|@REPO@|$REPO|g" -e "s|@FB@|$SFB|g" "$REPO/install/vyron-splash.service" > "$SPLASHF"
  sudo install -m 644 "$SPLASHF" "$SPLASH_UNIT"
  rm -f "$SPLASHF"
  sudo systemctl daemon-reload
  sudo systemctl enable vyron-splash.service >/dev/null 2>&1
  ok "boot animation enabled on $SFB"
fi

say "Done$([ $DRY = 1 ] && echo ' (dry-run — nothing changed)')"
info "Bring KlipperScreen back: $REPO/install/screen.sh --remove"
