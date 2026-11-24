"""Vyron Core — the Vyron helper service running next to Moonraker.

The main rule: the core never controls the printer. It only reads state, writes to its own part of the
Moonraker database (vyron* namespaces) and broadcasts events to clients. See safety.py.
"""

__version__ = "0.5.0-beta"
CLIENT_NAME = "vyron-core"
