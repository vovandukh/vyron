"""Live design sync between devices.

Vyron Web stores the theme in the Moonraker database (vyron_ui/design, the updated field — change time). Moonraker
doesn't notify clients about database changes, so every few seconds the core reads this entry (a cheap
local query) and, when updated changes, broadcasts design_changed. Every open client
(browsers, Vyron Screen) pulls the new theme right away. The core never changes the theme — it only reports.
"""

import asyncio
import logging

from .moonraker import MoonrakerError

log = logging.getLogger("vyron.design")

NAMESPACE = "vyron_ui"
# Only the change timestamp (a nested key), not the whole design — a request of a few bytes
KEY = "design.updated"
EVENT = "design_changed"


class DesignSync:
    def __init__(self, interval=2.0):
        self.interval = interval
        self._known = False  # the vyron_ui namespace already exists in the database

    async def _updated(self, client):
        # Until someone saves a theme the namespace doesn't exist, and every get_item would log "not found" in moonraker.log.
        # So we check the namespace list first (no errors) and read the key only once the namespace appears.
        if not self._known:
            try:
                r = await client.call("server.database.list")
            except MoonrakerError:
                return None
            if NAMESPACE not in ((r or {}).get("namespaces") or []):
                return None
            self._known = True
        try:
            r = await client.call("server.database.get_item", {"namespace": NAMESPACE, "key": KEY})
        except MoonrakerError:
            self._known = False
            return None  # no entry yet — nobody has saved a theme
        value = (r or {}).get("value")
        return value if isinstance(value, (int, float)) else None

    async def run(self, client):
        last = await self._updated(client)
        log.info("design sync started (updated=%s)", last)
        while client.connected:
            await asyncio.sleep(self.interval)
            if not client.connected:
                break
            cur = await self._updated(client)
            if cur is not None and cur != last:
                last = cur
                await client.send_event(EVENT, {"updated": cur})
                log.info("design changed, notified clients (updated=%s)", cur)
