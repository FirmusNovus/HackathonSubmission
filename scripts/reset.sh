#!/usr/bin/env bash
# scripts/reset.sh — wipe all state (anvil chain + both SQLite DBs) by
# rebuilding the container. Idempotent. Re-uses the image cache so it's
# fast (no Docker rebuild unless source changed).
#
# This is the JURY/Docker reset. The bare-metal dev reset lives at
# scripts/dev-reset.sh and is invoked via `pnpm reset` for development.
#
# Usage:  bash scripts/reset.sh
#         bash scripts/reset.sh --ngrok    # restart with the ngrok tunnel

set -euo pipefail
cd "$(dirname "$0")/.."

NAME=${NAME:-firmus-novus}
OTS_NAME=${OTS_NAME:-firmus-otterscan}
USE_NGROK=0
for arg in "$@"; do
  case "$arg" in
    --ngrok) USE_NGROK=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }

step "Stopping containers ${NAME} + ${OTS_NAME}"
docker rm -f "$NAME" "$OTS_NAME" >/dev/null 2>&1 || true
ok "stopped"

# Clear any host-side ngrok tunnel too — fresh start.
if pgrep -f 'ngrok http' >/dev/null 2>&1; then
  step "Stopping ngrok"
  pkill -f 'ngrok http' || true
  ok "ngrok stopped"
fi

if [ "$USE_NGROK" = 1 ]; then
  exec bash scripts/start-ngrok.sh
else
  exec bash scripts/start.sh
fi
