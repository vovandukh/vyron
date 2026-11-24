"""The core switches to a new version of its own code by itself.

Update Manager updates the repository (git pull) but doesn't let Moonraker restart the vyron-core service
(managed_services accepts only the section name, klipper and moonraker). So every few seconds the core looks
at the modification time of its own files (os.stat, no reading) and, when they change, exits with code 75 —
systemd (Restart=on-failure) starts it again with the new code. The printer isn't affected.
"""

import asyncio
import logging
import os

log = logging.getLogger("vyron.core")

EXIT_RELOAD = 75   # EX_TEMPFAIL: "restart me"
SETTLE = 3.0       # git pull doesn't write all files at once — wait until everything is written


def package_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _default_reload():
    log.info("core code updated, restarting to load the new version")
    logging.shutdown()
    os._exit(EXIT_RELOAD)


class CodeWatch:
    def __init__(self, root=None, interval=5.0, settle=SETTLE, on_change=None):
        self.root = root or package_dir()
        self.interval = interval
        self.settle = settle
        self.on_change = on_change or _default_reload

    def snapshot(self):
        snap = {}
        try:
            names = os.listdir(self.root)
        except OSError:
            return snap
        for n in names:
            if n.endswith(".py"):
                try:
                    st = os.stat(os.path.join(self.root, n))
                    snap[n] = (st.st_mtime_ns, st.st_size)
                except OSError:
                    pass
        return snap

    async def run(self, client):
        last = self.snapshot()
        while client.connected:
            await asyncio.sleep(self.interval)
            if self.snapshot() == last:
                continue
            await asyncio.sleep(self.settle)
            self.on_change()
            return
