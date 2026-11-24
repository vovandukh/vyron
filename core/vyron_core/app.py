"""Main loop: connect to Moonraker, start the core features, on disconnect wait quietly and retry.

If Moonraker is off or restarting, the core simply waits (with a back-off up to a minute)
and does nothing. A failure in any feature affects neither the printer nor the other features.
"""

import asyncio
import logging

from .announce import Announce
from .backups import KlipperBackups
from .code_watch import CodeWatch
from .design_sync import DesignSync
from .moonraker import MoonrakerClient
from .ui_watch import UiWatch

log = logging.getLogger("vyron.core")


class App:
    def __init__(self, config):
        self.config = config
        self.features = [Announce(), CodeWatch()]
        if config.getbool("design_sync", "enabled"):
            self.features.append(DesignSync(interval=config.getfloat("design_sync", "interval", minimum=1.0)))
        if config.getbool("ui_watch", "enabled"):
            root = config.get("ui_watch", "root").strip() or None
            self.features.append(UiWatch(root=root, interval=config.getfloat("ui_watch", "interval", minimum=1.0)))
        if config.getbool("backups", "enabled"):
            self.features.append(KlipperBackups())
        self._stop = None

    def stop(self):
        if self._stop is not None and not self._stop.done():
            self._stop.set_result(True)

    async def _session(self, client):
        tasks = [asyncio.ensure_future(self._guard(f, client)) for f in self.features]
        try:
            await asyncio.wait([client.closed, self._stop], return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            for t in tasks:
                try:
                    await t
                except asyncio.CancelledError:
                    pass

    async def _guard(self, feature, client):
        name = feature.__class__.__name__
        try:
            await feature.run(client)
        except asyncio.CancelledError:
            raise
        except ConnectionError:
            log.debug("%s: connection lost", name)  # a regular disconnect — run() reconnects
        except Exception:
            # One feature crashing doesn't stop the core; it retries after reconnecting
            log.exception("%s stopped with an error", name)

    async def run(self):
        self._stop = asyncio.get_event_loop().create_future()
        socket = self.config.path_of("moonraker", "socket")
        delay = 2
        while not self._stop.done():
            client = MoonrakerClient(socket)
            try:
                await client.connect()
                delay = 2
                await self._session(client)
            except (OSError, ConnectionError, asyncio.TimeoutError) as e:
                log.info("Moonraker not available (%s), retrying in %ss", e.__class__.__name__, delay)
            finally:
                await client.close()
            if self._stop.done():
                break
            try:
                await asyncio.wait_for(asyncio.shield(self._stop), delay)
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, 60)
        log.info("Vyron Core stopped")
