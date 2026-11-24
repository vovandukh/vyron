#!/usr/bin/env bash
# Removes the Vyron Core service. The code, vyron.conf and the log stay in place.
set -euo pipefail
UNIT=/etc/systemd/system/vyron-core.service

if [ -f "$UNIT" ]; then
  sudo systemctl disable --now vyron-core.service || true
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  echo "Vyron Core stopped and removed from services."
else
  echo "The vyron-core service isn't installed — nothing to do."
fi
