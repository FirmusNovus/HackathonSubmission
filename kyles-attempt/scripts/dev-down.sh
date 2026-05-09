#!/usr/bin/env bash
# scripts/dev-down.sh — stop the dev server.
#
# Usage:
#   ./scripts/dev-down.sh         # stop dev server (SQLite file preserved)
#   ./scripts/dev-down.sh --wipe  # also delete prisma/dev.db (data lost)

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
  step "Removing SQLite database"
  rm -f prisma/dev.db prisma/dev.db-journal
  ok "database file removed"
fi
