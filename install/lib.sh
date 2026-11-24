# Shared functions for install.sh / uninstall.sh. Not meant to run on its own.
# shellcheck shell=bash

MARK_BEGIN="# >>> vyron: this block is managed by install/install.sh — do not edit by hand >>>"
# Older installs wrote the marker in Ukrainian — blocks are found by this prefix, so both are recognised
MARK_PREFIX="# >>> vyron"
MARK_END="# <<< vyron <<<"
TS="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "${DRY:-0}" = 1 ]; then info "[dry-run] $*"; else "$@"; fi; }

preflight() {
  [ "$(uname -s)" = Linux ] || die "This script runs on Linux only (on the printer host)."
  if [ "$(id -u)" = 0 ] && [ -z "${SUDO_USER:-}" ]; then
    die "Run as a regular user (e.g. biqu or pi) — sudo is asked for when needed."
  fi
  USER_NAME="${SUDO_USER:-$(id -un)}"
  USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
  DATA="${PRINTER_DATA:-$USER_HOME/printer_data}"
  [ -d "$DATA" ] || die "$DATA not found. Set the path: PRINTER_DATA=/path $0"
  MR_CONF="$DATA/config/moonraker.conf"
  [ -f "$MR_CONF" ] || die "$MR_CONF not found."
  [ -d /etc/nginx/sites-enabled ] || die "nginx not found (/etc/nginx/sites-enabled). Install Mainsail or Fluidd first (KIAUH)."
  MR_PORT="$(awk '/^[[:space:]]*\[/{s=($0 ~ /^\[server\]/)} s && /^[[:space:]]*port[[:space:]]*[:=]/{v=$0; sub(/^[^:=]*[:=][[:space:]]*/,"",v); sub(/[[:space:]#].*$/,"",v); print v; exit}' "$MR_CONF")"
  MR_PORT="${MR_PORT:-7125}"
  STATE="$USER_HOME/.config/vyron/install.state"
  # sudo -n — passwordless (NOPASSWD, running without a terminal); otherwise ask for the password. "sudo -v" alone
  # asks for a password when a regular "(ALL : ALL) ALL" rule sits next to NOPASSWD.
  if [ "${DRY:-0}" = 0 ]; then sudo -n true 2>/dev/null || sudo -v || die "sudo is required."; fi
}

valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
# Ports Chrome/Firefox refuse to open (ERR_UNSAFE_PORT)
unsafe_port() {
  case " 1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 103 104 109 110 111 113 115 117 119 123 135 137 139 143 161 179 389 427 465 512 513 514 515 526 530 531 532 540 548 554 556 563 587 601 636 989 990 993 995 1719 1720 1723 2049 3659 4045 5060 5061 6000 6566 6665 6666 6667 6668 6669 6697 10080 " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

listens_on()  { grep -Eq "^[[:space:]]*listen[[:space:]]+(\[::\]:)?$2([[:space:];])" "$1"; }
listen_port() { sed -nE 's/^[[:space:]]*listen[[:space:]]+([0-9]+)[[:space:];].*/\1/p' "$1" | head -n1; }
is_web_ui()   { grep -Eiq '^[[:space:]]*root[[:space:]]+[^;]*(mainsail|fluidd)' "$1"; }
port_busy()   { command -v ss >/dev/null && [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]; }
# Is a systemd service installed (no pipe into grep -q: under pipefail that gives a false "no")
has_unit()    { case "$(systemctl list-unit-files "$1" 2>/dev/null)" in *"$1"*) return 0 ;; esac; return 1; }
# Is a package available in the apt repositories
has_pkg()     { case "$(LC_ALL=C apt-cache policy "$1" 2>/dev/null)" in *"Candidate: "[0-9]*) return 0 ;; esac; return 1; }
backup_name() { echo "$1.vyron-bak-$TS"; }

# Is a print running (then Moonraker isn't restarted). Unknown — assume not.
printer_busy() {
  command -v curl >/dev/null || return 1
  local r
  r="$(curl -fsS -m 3 "http://127.0.0.1:$MR_PORT/printer/objects/query?print_stats=state" 2>/dev/null)" || return 1
  [[ "$r" =~ \"state\":\ ?\"(printing|paused)\" ]]
}

# ---------- install state (what exactly we changed — for uninstall) ----------
state_load() { [ -f "$STATE" ] || return 0; }
state_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | tail -n1 || true; }
state_set() {
  [ "${DRY:-0}" = 1 ] && return 0
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  local tmp; tmp="$(mktemp)"
  grep -v "^$1=" "$STATE" > "$tmp" || true
  echo "$1=$2" >> "$tmp"
  cat "$tmp" > "$STATE"; rm -f "$tmp"
}

# ---------- moonraker.conf ----------
# Remove our block between the markers
strip_block() { awk -v b="$MARK_PREFIX" -v e="$MARK_END" 'index($0,b)==1{skip=1;next} $0==e{skip=0;next} !skip' "$1"; }
# Drop trailing empty lines (stdin → stdout)
trim_tail() { awk '{a[NR]=$0} END{n=NR; while(n>0 && a[n] ~ /^[[:space:]]*$/) n--; for(i=1;i<=n;i++) print a[i]}'; }
# Names of [update_manager X] sections (except ours) pointing at the same folder — old manual-install entries
legacy_um_sections() {
  awk -v home="$USER_HOME" -v repo="$2" '
    /^[[:space:]]*\[/ { sec=""; if ($0 ~ /^\[update_manager[[:space:]]+[^]]+\]/) { s=$0; sub(/^\[update_manager[[:space:]]+/,"",s); sub(/\].*/,"",s); sec=s }; next }
    sec!="" && sec!="vyron" && /^[[:space:]]*path[[:space:]]*[:=]/ {
      v=$0; sub(/^[^:=]*[:=][[:space:]]*/,"",v); sub(/[[:space:]]+$/,"",v); sub(/^~/,home,v); sub(/\/+$/,"",v)
      if (v==repo) print sec
    }' "$1"
}
# Remove [update_manager X] sections for X in the list (stdin → stdout)
remove_sections() {
  awk -v names=" $1 " '
    /^[[:space:]]*\[/ { drop=0; if ($0 ~ /^\[update_manager[[:space:]]+[^]]+\]/) { s=$0; sub(/^\[update_manager[[:space:]]+/,"",s); sub(/\].*/,"",s); if (index(names, " " s " ")) drop=1 } }
    !drop { print }'
}
