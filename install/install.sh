#!/usr/bin/env bash
# Vyron — install on the printer (Klipper + Moonraker + nginx).
#
#   ~/vyron/install/install.sh             — install or repair (safe to run again)
#   ~/vyron/install/install.sh --dry-run   — only show what would be done
#
# What it does:
#   1. nginx site "vyron": Vyron Web at http://IP/ (port 80), Vyron Screen at http://IP/screen.html.
#      Hides Mainsail/Fluidd — disables their nginx sites (files and updates untouched, uninstall restores them).
#      With --mainsail-port N Mainsail isn't hidden but moves to port N.
#      With --port N Vyron takes its own port and Mainsail stays as it was.
#   2. An [update_manager vyron] entry in moonraker.conf — one-click updates from Mainsail/Vyron.
#   3. The Vyron Core service (instant theme and update sync between screens); --no-core skips it.
#   4. Printer screen: Vyron Screen instead of KlipperScreen (KlipperScreen is only hidden; see screen.sh).
# What it does NOT do: touch Klipper or printer.cfg, move or heat the printer. Everything it changes is
# backed up first; if nginx rejects the new configuration, everything is rolled back.
# Uninstall: install/uninstall.sh
set -euo pipefail

PORT=80
MAINSAIL_PORT=""
DRY=0
UPDATES=1
CORE=1
SCREEN=1
CHANNEL=""
SCREEN_ARGS=()
ARGS=("$@")

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'
Options:
  --dry-run           change nothing, only show the steps
  --port N            port for Vyron (default 80); if not 80, Mainsail is left alone
  --mainsail-port N   don't hide Mainsail/Fluidd, move it to port N (e.g. 66)
  --no-updates        don't add the Update Manager entry
  --no-core           don't install the Vyron Core service
  --no-screen         leave the printer screen alone (KlipperScreen stays)
  --gpu               a board with a GPU (Raspberry Pi 4/5, CM4, Orange Pi 5): acceleration for the screen.
                      Without it (the default) the CPU draws the screen — for CB1, Pi 3, SPI screens
  --no-gpu            turn acceleration off if it was installed with --gpu
  --screen-app web    EXPERIMENTAL, only with --gpu: the full Vyron Web (with 3D) on the printer screen
                      instead of Vyron Screen. Back: --screen-app screen
  --channel stable|dev  update channel: stable — tested releases (stable branch),
                      dev — every change at once (main branch). Without it — the current branch's channel.
  --stable / --dev    the same, shorter
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --port) PORT="${2:-}"; shift ;;
    --mainsail-port) MAINSAIL_PORT="${2:-}"; shift ;;
    --no-updates) UPDATES=0 ;;
    --core) CORE=1 ;;
    --no-core) CORE=0 ;;
    --no-screen) SCREEN=0 ;;
    --gpu) SCREEN_ARGS+=(--gpu) ;;
    --no-gpu) SCREEN_ARGS+=(--no-gpu) ;;
    --screen-app) SCREEN_ARGS+=(--app "${2:-}"); shift ;;
    --channel) CHANNEL="${2:-}"; shift ;;
    --stable) CHANNEL=stable ;;
    --dev) CHANNEL=dev ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# ---------- common ----------
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib.sh
. "$REPO/install/lib.sh"

say "Vyron — install$([ $DRY = 1 ] && echo ' (dry-run: changing nothing)')"
preflight
valid_port "$PORT" || die "Invalid Vyron port \"$PORT\"."
unsafe_port "$PORT" && die "Browsers block port $PORT as unsafe — pick another one."
# Mainsail/Fluidd mode: hide — disable; move — move to MAINSAIL_PORT; keep — leave alone (Vyron isn't on 80)
if [ "$PORT" != 80 ]; then
  MODE=keep
  [ -z "$MAINSAIL_PORT" ] || warn "--mainsail-port is ignored: Vyron takes port $PORT, Mainsail stays as it was"
elif [ -n "$MAINSAIL_PORT" ]; then
  MODE=move
  valid_port "$MAINSAIL_PORT" || die "Invalid Mainsail port \"$MAINSAIL_PORT\"."
  unsafe_port "$MAINSAIL_PORT" && die "Browsers block port $MAINSAIL_PORT as unsafe — pick another one (e.g. 66 or 8081)."
  [ "$PORT" != "$MAINSAIL_PORT" ] || die "Vyron and Mainsail need different ports."
else
  MODE=hide
fi

# ---------- update channel: stable (stable branch) or dev (main branch) ----------
CUR_BRANCH="$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$CHANNEL" in
  "") case "$CUR_BRANCH" in stable) CHANNEL=stable ;; *) CHANNEL=dev ;; esac ;;
  stable|dev) ;;
  *) die "Unknown channel \"$CHANNEL\" — stable or dev." ;;
esac
WANT_BRANCH="$([ "$CHANNEL" = stable ] && echo stable || echo main)"
TARGET_BRANCH="${CUR_BRANCH:-main}"  # the branch the repository will be on after this step
if [ -n "$CUR_BRANCH" ] && [ "$CUR_BRANCH" != "$WANT_BRANCH" ] && { [ "$CHANNEL" = stable ] || [ "$CUR_BRANCH" = stable ]; }; then
  # Switch the repository to the channel's branch. Another development branch (not main/stable) stays as is with --dev.
  say "Channel $CHANNEL: switching $REPO from $CUR_BRANCH to $WANT_BRANCH"
  [ -z "$(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null)" ] ||
    die "$REPO has modified files — switching the channel would overwrite them. Commit or discard the changes (git status)."
  TARGET_BRANCH="$WANT_BRANCH"
  if [ $DRY = 1 ]; then
    info "[dry-run] git fetch origin $WANT_BRANCH && git checkout -B $WANT_BRANCH origin/$WANT_BRANCH"
  else
    git -C "$REPO" fetch -q origin "$WANT_BRANCH" || die "Couldn't fetch the $WANT_BRANCH branch from GitHub."
    git -C "$REPO" checkout -q -B "$WANT_BRANCH" "origin/$WANT_BRANCH"
    git -C "$REPO" branch -q --set-upstream-to="origin/$WANT_BRANCH" "$WANT_BRANCH"
    ok "repository on the $WANT_BRANCH branch"
    # The script may have changed with the branch — continue with the new version
    exec bash "$REPO/install/install.sh" "${ARGS[@]}"
  fi
fi
[ -f "$REPO/index.html" ] || die "$REPO has no index.html — this isn't a Vyron repository or the build isn't ready yet."
info "channel:      $CHANNEL ($TARGET_BRANCH branch)"

info "repository:   $REPO"
info "user:         $USER_NAME"
info "printer_data: $DATA"
info "Moonraker:    port $MR_PORT"

state_load

# ---------- 1. nginx ----------
say "1. nginx site"
SITE_AV=/etc/nginx/sites-available/vyron
SITE_EN=/etc/nginx/sites-enabled/vyron

# Other sites: Mainsail/Fluidd are hidden (all of them, on any port) or moved off our port;
# the default nginx site on our port is disabled; other people's sites are left alone.
TO_MOVE=()
TO_DISABLE=()
for f in /etc/nginx/sites-enabled/*; do
  [ -e "$f" ] || continue
  [ "$(basename "$f")" = vyron ] && continue
  real="$(readlink -f "$f")"
  if is_web_ui "$real"; then
    if [ $MODE = hide ]; then TO_DISABLE+=("$f"); continue; fi
    listens_on "$real" "$PORT" || continue
    [ $MODE = move ] || die "Port $PORT is taken by $(basename "$f"). Pick a free port (--port)."
    TO_MOVE+=("$real")
  elif listens_on "$real" "$PORT"; then
    [ "$(basename "$f")" = default ] || die "Port $PORT is already used by $f (not Mainsail/Fluidd). Run with --port 8080 or free the port."
    TO_DISABLE+=("$f")
  fi
done

# Moving Mainsail to MAINSAIL_PORT — only when Vyron takes port 80
for real in "${TO_MOVE[@]+"${TO_MOVE[@]}"}"; do
  if port_busy "$MAINSAIL_PORT"; then
    die "Port $MAINSAIL_PORT is used by another program — pick another one: --mainsail-port N"
  fi
  info "$(basename "$real"): port $PORT → $MAINSAIL_PORT (backup: $(backup_name "$real"))"
done
for f in "${TO_DISABLE[@]+"${TO_DISABLE[@]}"}"; do info "$(basename "$f"): hidden — its nginx site is disabled, files stay (restored on uninstall)"; done

# Manual install (before this script): Mainsail already on another port — remember it so uninstall moves it back to 80
if [ "$PORT" = 80 ] && [ -z "$(state_get MOVED)" ]; then
  for f in /etc/nginx/sites-enabled/*; do
    [ -e "$f" ] || continue
    real="$(readlink -f "$f")"
    [ "$(basename "$f")" = vyron ] && continue
    is_web_ui "$real" || continue
    p="$(listen_port "$real")"
    if [ -n "$p" ] && [ "$p" != 80 ]; then
      info "$(basename "$real") is already on port $p (moved earlier by hand) — remembering it for restore"
      LEGACY_MOVED="$real|80|$p"
    fi
  done
fi

ROOT_OK=1
case "$(stat -c %A "$USER_HOME")" in
  *[xt]) ;;
  *) ROOT_OK=0
     warn "nginx can't enter $USER_HOME — adding the traverse permission (chmod o+x, no permission to list files)." ;;
esac

CONF="$(mktemp)"
trap 'rm -f "$CONF"' EXIT
DEF=""; [ "$PORT" = 80 ] && DEF=" default_server"
sed -e "s|@PORT@|$PORT|g" -e "s|@DEFAULT@|$DEF|g" -e "s|@ROOT@|$REPO|g" -e "s|@MOONRAKER_PORT@|$MR_PORT|g" \
  "$REPO/install/nginx-vyron.conf" > "$CONF"

if [ $DRY = 1 ]; then
  info "$SITE_AV will be:"; sed 's/^/      | /' "$CONF"
else
  UNDO=()
  # An old vyron site (manual install) goes to a backup
  if [ -f "$SITE_AV" ] && ! cmp -s "$CONF" "$SITE_AV"; then
    b="$(backup_name "$SITE_AV")"; sudo cp -a "$SITE_AV" "$b"
    UNDO+=("sudo cp -a $(printf %q "$b") $(printf %q "$SITE_AV")")
  elif [ ! -f "$SITE_AV" ]; then
    UNDO+=("sudo rm -f $(printf %q "$SITE_AV") $(printf %q "$SITE_EN")")
  fi
  sudo install -m 644 "$CONF" "$SITE_AV"
  sudo ln -sfn "$SITE_AV" "$SITE_EN"

  MOVED_NOW=""
  for real in "${TO_MOVE[@]+"${TO_MOVE[@]}"}"; do
    b="$(backup_name "$real")"; sudo cp -a "$real" "$b"
    UNDO+=("sudo cp -a $(printf %q "$b") $(printf %q "$real")")
    sudo sed -i -E "s/^([[:space:]]*listen[[:space:]]+(\[::\]:)?)$PORT([[:space:];])/\1$MAINSAIL_PORT\3/" "$real"
    MOVED_NOW="$MOVED_NOW $real|$PORT|$MAINSAIL_PORT"
  done
  DISABLED_NOW=""
  for f in "${TO_DISABLE[@]+"${TO_DISABLE[@]}"}"; do
    t="$(readlink -f "$f")"
    UNDO+=("sudo ln -sfn $(printf %q "$t") $(printf %q "$f")")
    sudo rm -f "$f"
    DISABLED_NOW="$DISABLED_NOW $f|$t"
  done
  [ $ROOT_OK = 1 ] || sudo chmod o+x "$USER_HOME"

  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
    ok "nginx accepted the configuration and reloaded"
  else
    warn "nginx rejected the new configuration — rolling everything back:"
    sudo nginx -t 2>&1 | sed 's/^/      /' || true
    for ((i=${#UNDO[@]}-1; i>=0; i--)); do eval "${UNDO[$i]}"; done
    die "Nothing was changed. Please send the error text above to the developers."
  fi
  state_set PORT "$PORT"
  ALL_MOVED="$MOVED_NOW ${LEGACY_MOVED:-}"
  [ -n "${ALL_MOVED// /}" ] && state_set MOVED "$(echo "$(state_get MOVED) $ALL_MOVED" | xargs)"
  [ -n "$DISABLED_NOW" ] && state_set DISABLED "$(echo "$(state_get DISABLED)$DISABLED_NOW" | xargs)"
  [ $ROOT_OK = 1 ] || state_set HOME_OX 1
fi

# ---------- 2. Update Manager ----------
MR_CHANGED=0
if [ $UPDATES = 1 ]; then
  say "2. Update Manager (moonraker.conf)"
  ORIGIN="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
  BRANCH="$TARGET_BRANCH"
  if [ -z "$ORIGIN" ]; then
    warn "$REPO has no git origin — skipping (update by hand with git pull)"
  else
    BLOCK="$(mktemp)"
    {
      echo "$MARK_BEGIN"
      echo "[update_manager vyron]"
      echo "type: git_repo"
      echo "channel: dev"
      echo "path: $REPO"
      echo "origin: $ORIGIN"
      echo "primary_branch: $BRANCH"
      # There is no separate "vyron" system service (Core restarts itself when its code changes),
      # so Moonraker mustn't look for one — otherwise it warns "not permitted to restart service vyron"
      echo "is_system_service: False"
      echo "$MARK_END"
    } > "$BLOCK"
    LEGACY="$(legacy_um_sections "$MR_CONF" "$REPO")"
    NEW="$(mktemp)"
    # The config without our block and without old entries for the same path, then an empty line and our block
    strip_block "$MR_CONF" | remove_sections "$LEGACY" | trim_tail > "$NEW"
    [ -s "$NEW" ] && echo >> "$NEW"
    cat "$BLOCK" >> "$NEW"
    for s in $LEGACY; do info "old [update_manager $s] entry with the same path — removing it ([update_manager vyron] replaces it)"; done
    if cmp -s "$NEW" "$MR_CONF"; then
      ok "entry already up to date"
    elif [ $DRY = 1 ]; then
      info "will be added to $MR_CONF:"; sed 's/^/      | /' "$BLOCK"
    else
      b="$(backup_name "$MR_CONF")"; cp -a "$MR_CONF" "$b"
      cat "$NEW" > "$MR_CONF"
      ok "added [update_manager vyron] (backup of the old file: $b)"
      MR_CHANGED=1
    fi
    # Old installs added vyron-core to moonraker.asvc and managed_services — Moonraker doesn't accept that
    # (a warning). Core now restarts itself when its code updates, so the entry is removed.
    ASVC="$DATA/moonraker.asvc"
    if [ -f "$ASVC" ] && grep -qx "vyron-core" "$ASVC"; then
      info "removing vyron-core from moonraker.asvc (no longer needed)"
      [ $DRY = 1 ] || { sed -i '/^vyron-core$/d' "$ASVC"; MR_CHANGED=1; }
    fi
    rm -f "$BLOCK" "$NEW"
  fi
else
  say "2. Update Manager — skipped (--no-updates)"
fi

# ---------- 3. Vyron Core ----------
if [ $CORE = 1 ]; then
  say "3. Vyron Core"
  if [ -f "$REPO/core/install.sh" ]; then
    if [ $DRY = 1 ]; then bash "$REPO/core/install.sh" --dry-run; else bash "$REPO/core/install.sh"; fi
    [ $DRY = 1 ] || state_set CORE 1
  else
    warn "this Vyron version has no Vyron Core yet — skipping"
  fi
fi

# ---------- Moonraker: reload the configuration ----------
if [ $MR_CHANGED = 1 ]; then
  if printer_busy; then
    warn "A print is running — not restarting Moonraker. After the print: sudo systemctl restart moonraker"
  else
    sudo systemctl restart moonraker && ok "Moonraker restarted (Klipper wasn't restarted)"
  fi
fi

# ---------- 4. Printer screen: Vyron Screen instead of KlipperScreen ----------
SCREEN_RES="unchanged (--no-screen)"
if [ $SCREEN = 1 ]; then
  say "4. Printer screen"
  if ! has_unit KlipperScreen.service; then
    info "KlipperScreen isn't installed — leaving the screen alone"
    SCREEN_RES="no KlipperScreen — unchanged"
  elif [ $DRY = 1 ]; then
    if bash "$REPO/install/screen.sh" --dry-run ${SCREEN_ARGS[@]+"${SCREEN_ARGS[@]}"}; then SCREEN_RES="Vyron Screen instead of KlipperScreen"
    else warn "the screen check failed (see above)"; SCREEN_RES="check failed — see above"; fi
  elif bash "$REPO/install/screen.sh" ${SCREEN_ARGS[@]+"${SCREEN_ARGS[@]}"}; then
    SCREEN_RES="Vyron Screen (KlipperScreen hidden)"
  else
    # screen.sh restores KlipperScreen by itself if something goes wrong; Vyron Web already works at that point
    warn "Vyron Screen didn't start — KlipperScreen stays on the screen. The rest of the install is fine."
    SCREEN_RES="KlipperScreen (Vyron Screen didn't start — see above)"
  fi
fi

# ---------- summary ----------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
URL="http://${IP:-<printer IP>}$([ "$PORT" = 80 ] || echo ":$PORT")"
say "Done$([ $DRY = 1 ] && echo ' (dry-run — nothing changed)')"
info "Vyron Web:    $URL/"
info "Vyron Screen: $URL/screen.html"
info "Screen:       $SCREEN_RES"
info "Updates:      channel $CHANNEL$([ "$CHANNEL" = stable ] && echo ' (tested releases)' || echo ' (every change at once)')"
if [ $MODE = hide ]; then
  info "Mainsail:     hidden (restore: uninstall.sh, or install with --mainsail-port 66)"
elif [ $MODE = move ]; then
  info "Mainsail:     http://${IP:-<IP>}:$MAINSAIL_PORT/"
fi
info "Uninstall:    $REPO/install/uninstall.sh"
