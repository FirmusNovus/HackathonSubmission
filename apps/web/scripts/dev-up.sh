#!/usr/bin/env bash
# scripts/dev-up.sh — bring up the full Firmus Novus dev stack:
#   1. Pending Prisma migrations (SQLite, file-based)
#   2. Database seed (only if empty)
#   3. Next.js dev server on http://localhost:3000
#
# Usage:
#   ./scripts/dev-up.sh           # bring up everything; tail dev server in foreground
#   ./scripts/dev-up.sh --reset   # also wipe + reseed the DB
#   ./scripts/dev-up.sh --no-dev  # initialise DB only, skip starting Next.js
#
# Stop the dev server with Ctrl-C (the SQLite file lives at prisma/dev.db).

set -euo pipefail

cd "$(dirname "$0")/.."

RESET=0
RUN_DEV=1
for arg in "$@"; do
  case "$arg" in
    --reset)   RESET=1 ;;
    --no-dev)  RUN_DEV=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# --- 0. Sanity ---------------------------------------------------------------
command -v node >/dev/null || die "node is not installed"
command -v npm  >/dev/null || die "npm is not installed"

# --- 1. Env file -------------------------------------------------------------
if [ ! -f .env ]; then
  step "Creating .env from .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null; then
    SECRET=$(openssl rand -base64 32)
    ADMIN=$(openssl rand -hex 16)
    sed -i.bak "s|replace-me-with-openssl-rand-base64-32|${SECRET}|" .env
    sed -i.bak "s|replace-me-with-a-random-secret|${ADMIN}|" .env
    rm -f .env.bak
    ok ".env initialised with random secrets"
  else
    warn "openssl not found — set AUTH_SECRET and ADMIN_API_KEY in .env manually"
  fi
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

# --- 2. Install deps if missing ---------------------------------------------
if [ ! -d node_modules ]; then
  step "Installing npm packages (first run)"
  npm install
  ok "deps installed"
fi

# --- 3. Migrations + seed ---------------------------------------------------
if [ "$RESET" = 1 ]; then
  step "Resetting database (--reset)"
  npx prisma migrate reset --force --skip-seed
  ok "schema reset"
fi

step "Applying pending migrations"
npx prisma migrate deploy >/dev/null
ok "schema is up to date"

step "Generating Prisma client"
npx prisma generate >/dev/null
ok "client generated"

# Seed only when the lawyers table is empty (or after a --reset).
SEED_NEEDED=0
if [ "$RESET" = 1 ]; then
  SEED_NEEDED=1
else
  COUNT=$(npx --yes prisma db execute --stdin <<<'SELECT COUNT(*) FROM "LawyerProfile";' 2>/dev/null \
    | grep -oE '[0-9]+' | head -1 || echo "0")
  if [ "${COUNT:-0}" = "0" ]; then SEED_NEEDED=1; fi
fi
if [ "$SEED_NEEDED" = 1 ]; then
  step "Seeding database"
  npx tsx prisma/seed.ts
  ok "seeded"
else
  ok "database already populated; skipping seed (use --reset to force)"
fi

# --- 4. Next.js dev server --------------------------------------------------
if [ "$RUN_DEV" = 0 ]; then
  step "Skipping Next.js dev server (--no-dev)"
  echo "Database is ready (prisma/dev.db). Start the app with: npm run dev"
  exit 0
fi

# Stop any stale dev server on :3000
if lsof -ti :3000 >/dev/null 2>&1; then
  warn "Port 3000 is in use — stopping the existing process"
  lsof -ti :3000 | xargs -r kill 2>/dev/null || true
  sleep 1
fi

step "Starting Next.js dev server on http://localhost:3000"
echo
exec npm run dev
