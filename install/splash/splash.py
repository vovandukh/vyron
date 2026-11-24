#!/usr/bin/env python3
"""Vyron — boot animation on the printer screen (TFT 480×320, straight to the framebuffer, standard Python only).

The vyron-splash service (installed by install/screen.sh) starts it right after the disks are mounted: the Vyron
logo drops in piece by piece, then three dots "breathe" below it. It keeps playing over the X server — Chromium
takes ~15 s to load on a CB1, and without this there would be a black screen and then a white flash. It stops once
Vyron Screen has painted its own splash (the same picture — the logo with the dots) and called 127.0.0.1:7138/painted
(apps/screen Splash.vue): from there the same animation continues inside the UI.

Frames (RGB565, gzip): assets/intro.565.gz and loop.565.gz, built by build.mjs from apps/screen/demo/boot.html.

  sudo python3 splash.py [--fb /dev/fb0] [--timeout 180] [--x-timeout 45]
"""
import argparse
import gzip
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 480, 320
ROW = W * 2
FRAME = W * H * 2
DT = 0.05  # 20 fps — as built by build.mjs
PING_PORT = 7138  # Vyron Screen reports "splash painted" here


def frames(name):
    with gzip.open(os.path.join(HERE, 'assets', name)) as f:
        data = f.read()
    return [data[i:i + FRAME] for i in range(0, len(data), FRAME)]


class Fb:
    """480×320 RGB565 framebuffer. show() writes only the rows that changed (the SPI screen refreshes only those)."""

    def __init__(self, dev):
        sysfs = '/sys/class/graphics/' + os.path.basename(dev)
        size = open(sysfs + '/virtual_size').read().strip()
        bpp = int(open(sysfs + '/bits_per_pixel').read())
        if size != '%d,%d' % (W, H) or bpp != 16:
            raise SystemExit('Expected %dx%d 16 bit, got %s: %s, %d bit' % (W, H, dev, size, bpp))
        self.stride = int(open(sysfs + '/stride').read())
        self.fd = os.open(dev, os.O_RDWR)
        self.shown = None

    def show(self, buf):
        prev = self.shown
        first, last = 0, H - 1
        if prev is not None:
            while first < H and buf[first * ROW:(first + 1) * ROW] == prev[first * ROW:(first + 1) * ROW]:
                first += 1
            if first == H:
                return
            while buf[last * ROW:(last + 1) * ROW] == prev[last * ROW:(last + 1) * ROW]:
                last -= 1
        if self.stride == ROW:
            os.pwrite(self.fd, buf[first * ROW:(last + 1) * ROW], first * ROW)
        else:
            for y in range(first, last + 1):
                os.pwrite(self.fd, buf[y * ROW:(y + 1) * ROW], y * self.stride)
        self.shown = buf


def x_running():
    """The X server is starting (cheap: only process names in /proc)."""
    for pid in os.listdir('/proc'):
        if pid.isdigit():
            try:
                if open('/proc/%s/comm' % pid).read().strip() in ('Xorg', 'X'):
                    return True
            except OSError:
                pass
    return False


def main():
    p = argparse.ArgumentParser(description='Vyron — boot animation on the printer screen')
    p.add_argument('--fb', default='/dev/fb0')
    p.add_argument('--timeout', type=float, default=180, help='play at most this long, s')
    p.add_argument('--x-timeout', type=float, default=45, help='at most this long after the X server starts, s')
    a = p.parse_args()

    # The screen driver (fbtft) may not be up yet — wait up to 30 s
    sysfs = '/sys/class/graphics/%s/virtual_size' % os.path.basename(a.fb)
    for _ in range(60):
        if os.path.exists(sysfs):
            break
        time.sleep(0.5)
    fb = Fb(a.fb)

    painted = threading.Event()

    class Ping(BaseHTTPRequestHandler):
        def do_GET(self):
            painted.set()
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

        def log_message(self, *args):
            pass
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PING_PORT), Ping)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    except OSError:
        pass

    intro, loop = frames('intro.565.gz'), frames('loop.565.gz')
    t0 = t = time.monotonic()
    x_seen = None
    i = 0
    while not painted.is_set():
        now = time.monotonic()
        if now - t0 > a.timeout or (x_seen and now - x_seen > a.x_timeout):
            break
        if x_seen is None and i % 10 == 0 and x_running():
            x_seen = now
        if x_seen:
            fb.shown = None  # X draws on this screen too — write whole frames, not just the changes
        fb.show(intro[i] if i < len(intro) else loop[(i - len(intro)) % len(loop)])
        i += 1
        t += DT
        time.sleep(max(0, t - time.monotonic()))


if __name__ == '__main__':
    main()
