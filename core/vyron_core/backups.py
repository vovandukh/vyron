"""Tidying Klipper backups: printer-YYYYMMDD_HHMMSS.cfg files move to config/backups/klipper/.

After every SAVE_CONFIG Klipper drops a copy of the old printer.cfg next to the configs, and after a few calibrations
the file list turns into a mess. The core moves such files into backups/klipper/ (under the same
name) — right after they appear (notify_filelist_changed) and, just in case, every few minutes.

It deletes nothing and never reads contents: only server.files.move of a specific file matching the exact name
pattern (safety.py allows only that) and creating two folders. Users clean backups up in Vyron Web.
Printing isn't affected: Klipper reads printer.cfg only at startup.
"""

import asyncio
import logging

from .moonraker import MoonrakerError
from .safety import BACKUP_DIR, KLIPPER_BACKUP

log = logging.getLogger("vyron.backups")


def _names(listing, key, field):
    return [e.get(field) for e in (listing or {}).get(key) or [] if isinstance(e, dict)]


class KlipperBackups:
    def __init__(self, interval=300.0, debounce=2.0):
        self.interval = interval
        self.debounce = debounce
        self._kick = None

    def _on_files(self, info=None, *_):
        item = (info or {}).get("item") or {}
        path = item.get("path") or ""
        if item.get("root") == "config" and KLIPPER_BACKUP.match(path) and self._kick is not None:
            self._kick.set()

    async def _mkdir(self, client, path):
        try:
            await client.call("server.files.post_directory", {"path": path})
        except MoonrakerError as e:
            # The folder already exists (another client created it between the check and the request) — not an error
            log.debug("post_directory %s: %s", path, e)

    async def _prepare(self, client, root):
        """Creates backups/ and backups/klipper/ if missing; returns the file names already in backups/klipper/."""
        if "backups" not in _names(root, "dirs", "dirname"):
            await self._mkdir(client, "config/backups")
        else:
            sub = await client.call("server.files.get_directory", {"path": "config/backups"})
            if "klipper" in _names(sub, "dirs", "dirname"):
                return set(_names(await client.call("server.files.get_directory", {"path": BACKUP_DIR}), "files", "filename"))
        await self._mkdir(client, BACKUP_DIR)
        return set()

    async def sweep(self, client):
        """Moves every Klipper backup out of the config root. Returns how many were moved."""
        root = await client.call("server.files.get_directory", {"path": "config"})
        names = sorted(n for n in _names(root, "files", "filename") if isinstance(n, str) and KLIPPER_BACKUP.match(n))
        if not names:
            return 0
        existing = await self._prepare(client, root)
        moved = 0
        for n in names:
            if n in existing:
                # The same one is already in backups/ — don't overwrite, let the user decide
                log.warning("backup %s already exists in %s, left in place", n, BACKUP_DIR)
                continue
            try:
                await client.call("server.files.move", {"source": "config/" + n, "dest": BACKUP_DIR + "/" + n})
                moved += 1
            except MoonrakerError as e:
                log.warning("could not move %s: %s", n, e)
        if moved:
            log.info("moved %d Klipper backup(s) to %s", moved, BACKUP_DIR)
        return moved

    async def run(self, client):
        self._kick = asyncio.Event()
        client.on("notify_filelist_changed", self._on_files)
        while client.connected:
            try:
                await self.sweep(client)
            except MoonrakerError as e:
                log.warning("backup sweep failed: %s", e)
            self._kick.clear()
            try:
                await asyncio.wait_for(self._kick.wait(), self.interval)
                # SAVE_CONFIG produces several events in a row — handle them in one pass
                await asyncio.sleep(self.debounce)
            except asyncio.TimeoutError:
                pass
