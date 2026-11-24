"""The core announces itself: after every connection it writes its version and start time to its own
Moonraker namespace (vyron_core/info). Vyron Web and Vyron Screen show it in About.
Writes only to its own namespace (allowed by safety.py), touches nothing else.
"""

import asyncio
import logging
import time

from . import __version__

log = logging.getLogger("vyron.core")

NAMESPACE = "vyron_core"
KEY = "info"


class Announce:
    def __init__(self, started=None):
        self.started = started or int(time.time())

    async def run(self, client):
        await client.call("server.database.post_item", {
            "namespace": NAMESPACE, "key": KEY,
            "value": {"version": __version__, "started": self.started},
        })
        log.info("announced version %s", __version__)
        # Nothing more to do — wait until the session ends
        while client.connected:
            await asyncio.sleep(3600)
