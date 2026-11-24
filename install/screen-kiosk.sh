#!/bin/sh
# Vyron Screen — the program xinit runs on the printer screen (instead of KlipperScreen).
# A full-screen browser without frames, cursor, hints or translator. Display and touch settings
# (xorg.conf.d) are the same as KlipperScreen's.
URL="${1:-http://127.0.0.1:7136/screen.html}"

# The screen never blanks or sleeps
xset s off 2>/dev/null
xset s noblank 2>/dev/null
xset -dpms 2>/dev/null

for b in chromium chromium-browser; do
  command -v "$b" >/dev/null && BROWSER="$b" && break
done
[ -n "${BROWSER:-}" ] || { echo "vyron-screen: chromium not found" >&2; exit 1; }

# GPU: VYRON_GPU=1 (install.sh --gpu) — acceleration; otherwise the CPU draws everything in a light mode
# (on CB1 and similar the browser can't create WebGL without this and loads the CPU needlessly)
if [ "${VYRON_GPU:-0}" = 1 ]; then
  GPU_FLAGS="--ignore-gpu-blocklist --enable-gpu-rasterization"
else
  GPU_FLAGS="--disable-gpu --enable-low-end-device-mode"
fi

# Screen size — so the window really covers the whole display
SIZE="$(xdpyinfo 2>/dev/null | sed -n 's/.*dimensions: *\([0-9]*\)x\([0-9]*\).*/\1,\2/p')"
# Chromium doesn't let a window be narrower than 500 px: on a 480 px screen (TFT35) the right 20 px of the page
# ended up off-screen. So we scale so that 500 px of the page become exactly the screen width (480/500 = 0.96).
W="${SIZE%,*}"
SCALE=""
if [ -n "$W" ] && [ "$W" -lt 500 ] 2>/dev/null; then
  SCALE="--force-device-scale-factor=$(awk -v w="$W" 'BEGIN { printf "%.4f", w / 500 }')"
fi

exec "$BROWSER" \
  --kiosk "$URL" \
  ${SIZE:+--window-size=$SIZE} --window-position=0,0 $SCALE \
  --user-data-dir="$HOME/.config/vyron-screen" \
  --noerrdialogs --no-first-run --disable-infobars \
  --disable-session-crashed-bubble --hide-crash-restore-bubble \
  --password-store=basic --disable-translate --disable-features=Translate,TranslateUI \
  --check-for-update-interval=31536000 --disable-background-networking --disable-sync \
  --disable-pinch --overscroll-history-navigation=0 --touch-events=enabled \
  $GPU_FLAGS --renderer-process-limit=1
