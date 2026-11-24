"""Vyron Core tests with a simulated Moonraker on a Unix socket (Linux/macOS only).

Run from the core folder:  python3 -m unittest discover -s tests -v
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from vyron_core import safety  # noqa: E402
from vyron_core.announce import Announce  # noqa: E402
from vyron_core.backups import KlipperBackups  # noqa: E402
from vyron_core.code_watch import CodeWatch  # noqa: E402
from vyron_core.design_sync import DesignSync  # noqa: E402
from vyron_core.moonraker import MoonrakerClient  # noqa: E402
from vyron_core.ui_watch import UiWatch  # noqa: E402

ETX = b"\x03"


class FakeMoonraker:
    """A minimal Moonraker: JSON-RPC over a Unix socket, an in-memory database, a log of every call."""

    def __init__(self, path):
        self.path = path
        self.calls = []
        self.events = []
        self.db = {}
        self.server = None
        self.writers = []
        # Config root files: folder -> {file name}; folders are the keys ("config", "config/backups", ...)
        self.fs = {"config": set()}

    def notify(self, method, params):
        for w in self.writers:
            w.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}).encode() + ETX)

    async def start(self):
        self.server = await asyncio.start_unix_server(self._client, path=self.path)

    async def stop(self):
        for w in self.writers:
            w.close()
        self.server.close()
        await self.server.wait_closed()

    def drop_clients(self):
        for w in self.writers:
            w.close()
        self.writers = []

    async def _client(self, reader, writer):
        self.writers.append(writer)
        try:
            while True:
                raw = await reader.readuntil(ETX)
                msg = json.loads(raw[:-1].decode())
                self.calls.append(msg["method"])
                writer.write(json.dumps(self._answer(msg)).encode() + ETX)
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass

    def _answer(self, msg):
        m, p, rid = msg["method"], msg.get("params") or {}, msg["id"]
        if m == "server.connection.identify":
            self.identity = p
            return {"jsonrpc": "2.0", "id": rid, "result": {"connection_id": 1}}
        if m == "connection.send_event":
            self.events.append(p)
            return {"jsonrpc": "2.0", "id": rid, "result": "ok"}
        if m == "server.database.post_item":
            self.db[(p["namespace"], p["key"])] = p["value"]
            return {"jsonrpc": "2.0", "id": rid, "result": {"namespace": p["namespace"], "key": p["key"], "value": p["value"]}}
        if m == "server.database.list":
            return {"jsonrpc": "2.0", "id": rid, "result": {"namespaces": sorted({ns for ns, _ in self.db})}}
        if m == "server.database.get_item":
            # As in Moonraker: "design.updated" is a nested field of the "design" entry
            root, *path = p["key"].split(".")
            value, found = self.db.get((p["namespace"], root)), (p["namespace"], root) in self.db
            for part in path:
                found = found and isinstance(value, dict) and part in value
                value = value.get(part) if found else None
            if not found:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": 404, "message": "Key not found"}}
            return {"jsonrpc": "2.0", "id": rid, "result": {"namespace": p["namespace"], "key": p["key"], "value": value}}
        if m == "server.files.get_directory":
            d = p.get("path")
            if d not in self.fs:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": 404, "message": "Directory does not exist"}}
            subs = sorted(k[len(d) + 1:] for k in self.fs if k.startswith(d + "/") and "/" not in k[len(d) + 1:])
            return {"jsonrpc": "2.0", "id": rid, "result": {
                "dirs": [{"dirname": n} for n in subs], "files": [{"filename": n} for n in sorted(self.fs[d])]}}
        if m == "server.files.post_directory":
            d = p["path"]
            if d in self.fs or d.rsplit("/", 1)[0] not in self.fs:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": 400, "message": "cannot create " + d}}
            self.fs[d] = set()
            return {"jsonrpc": "2.0", "id": rid, "result": {"action": "create_dir"}}
        if m == "server.files.move":
            sd, sn = p["source"].rsplit("/", 1)
            dd, dn = p["dest"].rsplit("/", 1)
            if sn not in self.fs.get(sd, ()) or dd not in self.fs:
                return {"jsonrpc": "2.0", "id": rid, "error": {"code": 404, "message": "not found"}}
            self.fs[sd].discard(sn)
            self.fs[dd].add(dn)
            return {"jsonrpc": "2.0", "id": rid, "result": {"action": "move_file"}}
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "Method not found"}}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.sock = os.path.join(self.dir, "moonraker.sock")
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.mr = FakeMoonraker(self.sock)
        self.loop.run_until_complete(self.mr.start())

    def tearDown(self):
        self.loop.run_until_complete(self.mr.stop())
        self.loop.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_async(self, coro, timeout=5):
        return self.loop.run_until_complete(asyncio.wait_for(coro, timeout))


class SafetyTest(unittest.TestCase):
    def test_printer_control_is_blocked(self):
        for m in ("printer.gcode.script", "printer.print.start", "printer.print.pause", "printer.print.cancel",
                  "printer.emergency_stop", "printer.restart", "printer.firmware_restart", "machine.reboot",
                  "machine.shutdown", "machine.services.restart", "server.files.delete_file", "machine.update.full"):
            with self.assertRaises(safety.SafetyError, msg=m):
                safety.check(m, {})

    def test_database_writes_only_own_namespace(self):
        safety.check("server.database.post_item", {"namespace": "vyron_ui", "key": "x", "value": 1})
        safety.check("server.database.post_item", {"namespace": "vyron_core", "key": "x", "value": 1})
        for ns in ("mainsail", "fluidd", "moonraker", None, 5):
            with self.assertRaises(safety.SafetyError):
                safety.check("server.database.post_item", {"namespace": ns, "key": "x", "value": 1})

    def test_backup_move_is_narrow(self):
        ok = "printer-20261121_101530.cfg"
        safety.check("server.files.move", {"source": "config/" + ok, "dest": "config/backups/klipper/" + ok})
        safety.check("server.files.post_directory", {"path": "config/backups"})
        safety.check("server.files.post_directory", {"path": "config/backups/klipper"})
        bad = [
            {"source": "config/printer.cfg", "dest": "config/backups/klipper/printer.cfg"},
            {"source": "config/" + ok, "dest": "config/backups/klipper/other.cfg"},
            {"source": "config/" + ok, "dest": "config/printer.cfg"},
            {"source": "config/" + ok, "dest": "gcodes/" + ok},
            {"source": "gcodes/" + ok, "dest": "config/backups/klipper/" + ok},
            {"source": "config/sub/" + ok, "dest": "config/backups/klipper/sub/" + ok},
            {"source": "config/../" + ok, "dest": "config/backups/klipper/../" + ok},
            {"source": "config/" + ok + "\n", "dest": "config/backups/klipper/" + ok + "\n"},
            {"source": "config/printer-2026112_101530.cfg", "dest": "config/backups/klipper/printer-2026112_101530.cfg"},
            {"source": "config/" + ok},
            {},
        ]
        for p in bad:
            with self.assertRaises(safety.SafetyError, msg=repr(p)):
                safety.check("server.files.move", p)
        for d in ("config", "config/backups/x", "gcodes/backups", "config/backups/klipper/..", None):
            with self.assertRaises(safety.SafetyError, msg=repr(d)):
                safety.check("server.files.post_directory", {"path": d})
        for m in ("server.files.copy", "server.files.delete_directory", "server.files.zip"):
            with self.assertRaises(safety.SafetyError, msg=m):
                safety.check(m, {"source": "config/" + ok, "dest": "config/backups/klipper/" + ok})

    def test_reads_allowed(self):
        safety.check("printer.objects.query", {"objects": {"print_stats": None}})
        safety.check("server.database.get_item", {"namespace": "mainsail", "key": "x"})


class ClientTest(Base):
    def test_identifies_as_agent(self):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        self.assertEqual(self.mr.identity["type"], "agent")
        self.assertEqual(self.mr.identity["client_name"], "vyron-core")
        self.run_async(c.close())

    def test_blocked_call_never_reaches_moonraker(self):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        before = list(self.mr.calls)
        with self.assertRaises(safety.SafetyError):
            self.run_async(c.call("printer.gcode.script", {"script": "G28"}))
        self.run_async(asyncio.sleep(0.05))
        self.assertEqual(self.mr.calls, before)
        self.run_async(c.close())

    def test_connection_loss_is_detected(self):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        self.mr.drop_clients()
        self.run_async(c.closed)
        self.assertFalse(c.connected)
        self.run_async(c.close())


class DesignSyncTest(Base):
    def test_broadcasts_once_per_change(self):
        self.mr.db[("vyron_ui", "design")] = {"updated": 100, "accent": "#ff6b5a"}
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(DesignSync(interval=0.05).run(c))
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.events, [], "no event for the design that was already there")
        self.mr.db[("vyron_ui", "design")] = {"updated": 200, "accent": "#3a7bfd"}
        self.run_async(asyncio.sleep(0.3))
        self.assertEqual(self.mr.events, [{"event": "design_changed", "data": {"updated": 200}}])
        task.cancel()
        self.run_async(c.close())

    def test_missing_design_is_quiet(self):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(DesignSync(interval=0.05).run(c))
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.events, [])
        self.assertFalse(task.done(), "keeps running while the design record does not exist")
        self.assertNotIn("server.database.get_item", self.mr.calls, "no 'not found' errors in moonraker.log")
        # A theme is saved for the first time — picked up
        self.mr.db[("vyron_ui", "design")] = {"updated": 300}
        self.run_async(asyncio.sleep(0.3))
        self.assertEqual(self.mr.events, [{"event": "design_changed", "data": {"updated": 300}}])
        task.cancel()
        self.run_async(c.close())


class BackupsTest(Base):
    def _start(self, **kw):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(KlipperBackups(interval=kw.get("interval", 60), debounce=0.05).run(c))
        return c, task

    def test_moves_existing_backups_and_creates_folders(self):
        self.mr.fs["config"] = {"printer.cfg", "macros.cfg", "printer-20261120_090000.cfg", "printer-20261121_101530.cfg", "printer-old.cfg"}
        c, task = self._start()
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.fs["config"], {"printer.cfg", "macros.cfg", "printer-old.cfg"})
        self.assertEqual(self.mr.fs["config/backups/klipper"], {"printer-20261120_090000.cfg", "printer-20261121_101530.cfg"})
        self.assertNotIn("server.files.delete_file", self.mr.calls)
        task.cancel()
        self.run_async(c.close())

    def test_new_backup_after_save_config(self):
        self.mr.fs.update({"config": {"printer.cfg"}, "config/backups": set(), "config/backups/klipper": set()})
        c, task = self._start()
        self.run_async(asyncio.sleep(0.1))
        self.assertNotIn("server.files.move", self.mr.calls, "nothing to move — no calls")
        self.assertNotIn("server.files.post_directory", self.mr.calls)
        # SAVE_CONFIG: Klipper renamed the old printer.cfg
        self.mr.fs["config"].add("printer-20261121_120000.cfg")
        self.mr.notify("notify_filelist_changed", [{"action": "move_file", "item": {"root": "config", "path": "printer-20261121_120000.cfg"}}])
        self.run_async(asyncio.sleep(0.3))
        self.assertEqual(self.mr.fs["config/backups/klipper"], {"printer-20261121_120000.cfg"})
        self.assertEqual(self.mr.fs["config"], {"printer.cfg"})
        task.cancel()
        self.run_async(c.close())

    def test_existing_copy_is_not_overwritten(self):
        name = "printer-20261121_101530.cfg"
        self.mr.fs.update({"config": {name}, "config/backups": set(), "config/backups/klipper": {name}})
        c, task = self._start()
        self.run_async(asyncio.sleep(0.2))
        self.assertIn(name, self.mr.fs["config"])
        self.assertNotIn("server.files.move", self.mr.calls)
        self.assertFalse(task.done())
        task.cancel()
        self.run_async(c.close())

    def test_editor_backups_folder_is_kept(self):
        self.mr.fs.update({"config": {"printer-20261121_101530.cfg"}, "config/backups": {"printer_20261101-120000.cfg"}})
        c, task = self._start()
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.fs["config/backups"], {"printer_20261101-120000.cfg"})
        self.assertEqual(self.mr.fs["config/backups/klipper"], {"printer-20261121_101530.cfg"})
        task.cancel()
        self.run_async(c.close())


class AnnounceTest(Base):
    def test_writes_version_to_own_namespace(self):
        from vyron_core import __version__
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(Announce(started=123).run(c))
        self.run_async(asyncio.sleep(0.1))
        self.assertEqual(self.mr.db[("vyron_core", "info")], {"version": __version__, "started": 123})
        self.assertFalse(task.done(), "keeps running quietly until the session ends")
        task.cancel()
        self.run_async(c.close())


class CodeWatchTest(Base):
    def test_reload_when_own_code_changes(self):
        with open(os.path.join(self.dir, "a.py"), "w") as f:
            f.write("x = 1\n")
        hits = []
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(CodeWatch(root=self.dir, interval=0.05, settle=0.05, on_change=lambda: hits.append(1)).run(c))
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(hits, [], "no reload while the code is unchanged")
        with open(os.path.join(self.dir, "a.py"), "w") as f:
            f.write("x = 22\n")
        self.run_async(asyncio.sleep(0.3))
        self.assertEqual(hits, [1])
        self.assertTrue(task.done())
        self.run_async(c.close())

    def test_default_root_is_the_package(self):
        self.assertTrue(os.path.isfile(os.path.join(CodeWatch().root, "code_watch.py")))


class UiWatchTest(Base):
    def _write(self, name, text):
        with open(os.path.join(self.dir, name), "w") as f:
            f.write(text)

    def test_one_event_per_update(self):
        self._write("index.html", "v1")
        self._write("screen.html", "v1")
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(UiWatch(root=self.dir, interval=0.05, settle=0.1).run(c))
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.events, [], "no event for the build that was already there")
        # git pull doesn't write files at once — there must be one event for both
        self._write("index.html", "v2 longer")
        self.run_async(asyncio.sleep(0.03))
        self._write("screen.html", "v2 longer")
        self.run_async(asyncio.sleep(0.4))
        self.assertEqual(self.mr.events, [{"event": "ui_updated", "data": {"files": ["index.html", "screen.html"]}}])
        task.cancel()
        self.run_async(c.close())

    def test_update_during_core_restart_is_announced(self):
        self._write("index.html", "v1")
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        # The core's first start: remembers the build, no events
        task = self.loop.create_task(UiWatch(root=self.dir, interval=0.05, settle=0.05).run(c))
        self.run_async(asyncio.sleep(0.15))
        task.cancel()
        self.assertEqual(self.mr.events, [])
        self.assertIn(("vyron_core", "build"), self.mr.db)
        # Update Manager updated the files while the core was stopped
        self._write("index.html", "v2 longer")
        task = self.loop.create_task(UiWatch(root=self.dir, interval=0.05, settle=0.05).run(c))
        self.run_async(asyncio.sleep(0.15))
        self.assertEqual(self.mr.events, [{"event": "ui_updated", "data": {"files": ["index.html"]}}])
        # The next restart without changes — silence
        task.cancel()
        task = self.loop.create_task(UiWatch(root=self.dir, interval=0.05, settle=0.05).run(c))
        self.run_async(asyncio.sleep(0.15))
        self.assertEqual(len(self.mr.events), 1)
        task.cancel()
        self.run_async(c.close())

    def test_missing_files_are_quiet(self):
        c = MoonrakerClient(self.sock)
        self.run_async(c.connect())
        task = self.loop.create_task(UiWatch(root=self.dir, interval=0.05, settle=0.05).run(c))
        self.run_async(asyncio.sleep(0.2))
        self.assertEqual(self.mr.events, [])
        self.assertFalse(task.done())
        task.cancel()
        self.run_async(c.close())

    def test_default_root_is_repo(self):
        root = UiWatch().root
        self.assertTrue(os.path.isfile(os.path.join(root, "core", "vyron_core", "ui_watch.py")))


if __name__ == "__main__":
    unittest.main()
