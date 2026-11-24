"""A new UI version — on every open screen at once.

Update Manager updates the Vyron repository (git pull), and the built pages index.html (Vyron Web) and
screen.html (Vyron Screen) change on disk. Every few seconds the core checks only their modification
time and size (os.stat — no reading) and, when something changed, broadcasts ui_updated.
Open pages reload by themselves as soon as nobody is using them. The core keeps the build fingerprint
in its own database namespace so an update that happened during its restart isn't missed.
Without the core the pages notice the new version themselves, with a delay of up to ~20 s.
"""

import asyncio
import logging
import os

from .moonraker import MoonrakerError

log = logging.getLogger("vyron.ui")

EVENT = "ui_updated"
# Fingerprint of the last seen build — in our own database namespace (allowed by safety.py)
DB_NS = "vyron_core"
DB_KEY = "build"
FILES = ("index.html", "screen.html")
# How long to wait for the files to settle: git pull doesn't write them at once — one event per update
SETTLE = 2.0


def repo_root():
    """Vyron repository root: core/vyron_core/ui_watch.py → two levels above the package."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class UiWatch:
    def __init__(self, root=None, interval=3.0, settle=SETTLE):
        self.root = os.path.expanduser(root) if root else repo_root()
        self.interval = interval
        self.settle = settle

    def snapshot(self):
        snap = {}
        for name in FILES:
            try:
                st = os.stat(os.path.join(self.root, name))
                snap[name] = (st.st_mtime_ns, st.st_size)
            except OSError:
                snap[name] = None
        return snap

    @staticmethod
    def _sig(snap):
        """Build fingerprint for the database: {"index.html": "mtime_ns:size", ...}"""
        return {n: ("%d:%d" % v if v else None) for n, v in sorted(snap.items())}

    async def _remember(self, client, snap):
        try:
            await client.call("server.database.post_item", {"namespace": DB_NS, "key": DB_KEY, "value": self._sig(snap)})
        except MoonrakerError:
            pass

    async def run(self, client):
        last = self.snapshot()
        log.info("ui watch started (%s)", self.root)
        # Update Manager restarts the core after git pull — the old core may not have noticed the file change.
        # So we compare with the build seen before the restart (saved in the database) and notify now if needed.
        try:
            prev = (await client.call("server.database.get_item", {"namespace": DB_NS, "key": DB_KEY}) or {}).get("value")
        except MoonrakerError:
            prev = None
        cur_sig = self._sig(last)
        if isinstance(prev, dict) and prev != cur_sig:
            changed = sorted(n for n in FILES if cur_sig.get(n) and prev.get(n) != cur_sig.get(n))
            if changed:
                await client.send_event(EVENT, {"files": changed})
                log.info("ui updated while core was restarting (%s), notified clients", ", ".join(changed))
        if prev != cur_sig:
            await self._remember(client, last)
        while client.connected:
            await asyncio.sleep(self.interval)
            if not client.connected:
                break
            cur = self.snapshot()
            if cur == last:
                continue
            # Let git pull finish writing the remaining files, then one event
            await asyncio.sleep(self.settle)
            cur = self.snapshot()
            changed = sorted(n for n in FILES if cur.get(n) != last.get(n) and cur.get(n) is not None)
            last = cur
            if changed:
                await client.send_event(EVENT, {"files": changed})
                log.info("ui updated (%s), notified clients", ", ".join(changed))
                await self._remember(client, cur)
