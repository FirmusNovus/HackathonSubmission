#!/usr/bin/env bash
# scripts/dev-down.sh — stop everything dev-up.sh started.
#
# Usage:
#   ./scripts/dev-down.sh         # stop dev server + Postgres container
#   ./scripts/dev-down.sh --wipe  # also delete the Postgres volume (data lost)

set -euo pipefail
cd "$(dirname "$0")/.."

WIPE=0
for arg in "$@"; do
  case "$arg" in
    --wipe) WIPE=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }

if lsof -ti :3000 >/dev/null 2>&1; then
  step "Stopping Next.js dev server on :3000"
  lsof -ti :3000 | xargs -r kill 2>/dev/null || true
  ok "stopped"
fi

if [ "$WIPE" = 1 ]; then
  step "Tearing down Postgres + volume"
  docker compose down -v
  ok "container removed and data wiped"
else
  step "Stopping Postgres container"
  docker compose down
  ok "container stopped (data preserved)"
fi
