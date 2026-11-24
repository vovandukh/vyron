"""Allow-list of Moonraker calls — the guarantee that Vyron Core never interferes with the printer.

Every core call goes through check(). Only these are allowed:
  * reading state (info, Klipper objects, the database);
  * writing and deleting database entries only in its own namespaces starting with "vyron";
  * identifying as an agent and broadcasting events to clients.

The only file exception is tidying Klipper backups (see backups.py): moving a file whose name exactly
matches printer-YYYYMMDD_HHMMSS.cfg from the config root to config/backups/klipper/ under the same name,
and creating those two folders. No reading, deleting or writing file contents.

Everything else — G-code, print start/pause/cancel, emergency stop, Klipper and host restarts,
services, files, updates — is blocked. A new method gets here only by a deliberate decision,
with its own switch in vyron.conf (e.g. a future auto-pause) and a test.
"""

import re

READ_ONLY = frozenset({
    "server.info",
    "server.config",
    "printer.info",
    "printer.objects.list",
    "printer.objects.query",
    "printer.objects.subscribe",
    "server.database.list",
    "server.database.get_item",
    "server.history.list",
    "server.history.totals",
    "server.files.get_directory",
})

AGENT = frozenset({
    "server.connection.identify",
    "connection.send_event",
})

DB_WRITE = frozenset({
    "server.database.post_item",
    "server.database.delete_item",
})

OWN_NAMESPACE_PREFIX = "vyron"

# The backup Klipper creates on SAVE_CONFIG (only the main printer.cfg, only in the config root)
KLIPPER_BACKUP = re.compile(r"\Aprinter-\d{8}_\d{6}\.cfg\Z")
BACKUP_DIR = "config/backups/klipper"
BACKUP_DIRS = frozenset({"config/backups", BACKUP_DIR})


def _backup_move_ok(params):
    src, dest = params.get("source"), params.get("dest")
    if not isinstance(src, str) or not isinstance(dest, str) or not src.startswith("config/"):
        return False
    name = src[len("config/"):]
    return bool(KLIPPER_BACKUP.match(name)) and dest == BACKUP_DIR + "/" + name


class SafetyError(Exception):
    """An attempt to call a method the core isn't allowed to use."""


def check(method, params=None):
    """Lets an allowed call through; otherwise raises SafetyError and nothing is sent."""
    if method in READ_ONLY or method in AGENT:
        return
    if method in DB_WRITE:
        ns = (params or {}).get("namespace")
        if isinstance(ns, str) and ns.startswith(OWN_NAMESPACE_PREFIX):
            return
        raise SafetyError("Vyron Core may only write its own database namespaces (vyron*), not %r" % (ns,))
    if method == "server.files.move":
        if _backup_move_ok(params or {}):
            return
        raise SafetyError("Vyron Core may only move Klipper backups into %s, not %r" % (BACKUP_DIR, params))
    if method == "server.files.post_directory":
        if (params or {}).get("path") in BACKUP_DIRS:
            return
        raise SafetyError("Vyron Core may only create the backup folders, not %r" % ((params or {}).get("path"),))
    raise SafetyError("Vyron Core is not allowed to call %r" % (method,))
