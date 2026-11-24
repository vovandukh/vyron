"""Moonraker client over the local Unix socket (printer_data/comms/moonraker.sock).

The protocol is JSON-RPC 2.0, each message ends with an ETX byte (0x03). The socket connection is
trusted (no tokens), no network needed. The core identifies as an agent ("agent"): this lets Moonraker
broadcast its events to all clients (notify_agent_event).
Every call goes through safety.check() first.
"""

import asyncio
import json
import logging

from . import CLIENT_NAME, __version__
from .safety import check

ETX = b"\x03"
log = logging.getLogger("vyron.moonraker")


class MoonrakerError(Exception):
    def __init__(self, code, message):
        super().__init__("%s (%s)" % (message, code))
        self.code = code


class MoonrakerClient:
    def __init__(self, socket_path, timeout=10.0):
        self.socket_path = socket_path
        self.timeout = timeout
        self._reader = None
        self._writer = None
        self._read_task = None
        self._pending = {}
        self._next_id = 0
        self._handlers = {}
        self.closed = None  # asyncio.Future: resolves when the connection is lost

    @property
    def connected(self):
        return self.closed is not None and not self.closed.done()

    def on(self, method, fn):
        """Subscribe to Moonraker messages (notify_*)."""
        self._handlers.setdefault(method, []).append(fn)

    async def connect(self):
        self._reader, self._writer = await asyncio.open_unix_connection(self.socket_path, limit=1 << 22)
        self.closed = asyncio.get_event_loop().create_future()
        self._read_task = asyncio.ensure_future(self._read_loop())
        await self.call("server.connection.identify", {
            "client_name": CLIENT_NAME,
            "version": __version__,
            "type": "agent",
            "url": "https://github.com/vovandukh/vyron",
        })
        log.info("connected to Moonraker at %s", self.socket_path)

    async def call(self, method, params=None):
        check(method, params)
        if not self.connected:
            raise ConnectionError("not connected to Moonraker")
        self._next_id += 1
        rid = self._next_id
        msg = {"jsonrpc": "2.0", "method": method, "id": rid}
        if params is not None:
            msg["params"] = params
        fut = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        try:
            self._writer.write(json.dumps(msg).encode() + ETX)
            await self._writer.drain()
            return await asyncio.wait_for(fut, self.timeout)
        finally:
            self._pending.pop(rid, None)

    async def send_event(self, event, data=None):
        """An event for all Moonraker clients: they receive notify_agent_event."""
        return await self.call("connection.send_event", {"event": event, "data": data})

    async def _read_loop(self):
        try:
            while True:
                raw = await self._reader.readuntil(ETX)
                try:
                    msg = json.loads(raw[:-1].decode())
                except ValueError:
                    log.warning("ignored malformed message from Moonraker")
                    continue
                self._dispatch(msg)
        except (asyncio.IncompleteReadError, ConnectionError, OSError) as e:
            log.info("Moonraker connection closed: %s", e.__class__.__name__)
        except asyncio.CancelledError:
            pass
        finally:
            self._shutdown(ConnectionError("Moonraker connection closed"))

    def _dispatch(self, msg):
        rid = msg.get("id")
        if rid is not None and rid in self._pending:
            fut = self._pending[rid]
            if fut.done():
                return
            if "error" in msg:
                err = msg["error"] or {}
                fut.set_exception(MoonrakerError(err.get("code"), err.get("message", "error")))
            else:
                fut.set_result(msg.get("result"))
            return
        method = msg.get("method")
        for fn in self._handlers.get(method, ()):
            try:
                fn(*(msg.get("params") or []))
            except Exception:
                log.exception("handler for %s failed", method)

    def _shutdown(self, exc):
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()
        if self.closed is not None and not self.closed.done():
            self.closed.set_result(True)
        if self._writer is not None:
            self._writer.close()

    async def close(self):
        if self._read_task is not None:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        self._shutdown(ConnectionError("closed"))
