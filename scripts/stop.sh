#!/usr/bin/env bash
# scripts/stop.sh — tear down the Firmus Novus stack started by start.sh /
# start-ngrok.sh. Removes both Docker containers and any host-side ngrok.
# Idempotent: safe to run when nothing is up.
#
# Usage:  bash scripts/stop.sh

set -euo pipefail

NAME=${NAME:-firmus-novus}
OTS_NAME=${OTS_NAME:-firmus-otterscan}

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }

step "Stopping containers"
removed=$(docker rm -f "$NAME" "$OTS_NAME" 2>/dev/null || true)
if [ -n "$removed" ]; then
  echo "$removed" | sed 's/^/  removed: /'
else
  echo "  (no containers running)"
fi

step "Stopping ngrok"
if pgrep -f 'ngrok http' >/dev/null 2>&1; then
  pkill -f 'ngrok http' || true
  ok "ngrok stopped"
else
  echo "  (no ngrok running)"
fi

echo
ok "stack down"
