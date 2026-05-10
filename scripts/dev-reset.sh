#!/usr/bin/env bash
# Wipe-and-reseed everything that holds local state. Idempotent; safe to
# re-run. Keeps the issuer's signing keys (wwwallet caches metadata against
# them, so rotating those would invalidate any credentials already minted
# in your wallet).
#
# What this clears:
#   • apps/web Prisma DB           — users, bookings, conversations, messages,
#                                    nonces, verifier states, attestation UIDs
#   • apps/issuer SQLite DB        — persona rows + OID4VCI flow tables
#   • anvil chain state            — restart from block 0; contracts redeployed
#                                    (new addresses written to deployed-addresses.json)
#
# Usage:  pnpm reset
# Run `pnpm dev` afterwards to bring the stack back up.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }

# 1. Stop running dev processes (web/issuer/proxy) + anvil
step "Stopping dev servers and anvil"
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next dev"    2>/dev/null || true
pkill -9 -f "pnpm dev"    2>/dev/null || true
pkill -9 -f "concurrently" 2>/dev/null || true
pkill -9 -f "dotenv-cli"  2>/dev/null || true
pkill -9 -f "tsx watch"   2>/dev/null || true
pkill -9 -x "anvil"       2>/dev/null || true
sleep 2
ok "stopped"

# 2. Wipe local DBs
step "Wiping platform Prisma DB"
rm -f apps/web/prisma/dev.db apps/web/prisma/dev.db-journal apps/web/prisma/dev.db-shm apps/web/prisma/dev.db-wal
ok "apps/web/prisma/dev.db removed"

step "Wiping issuer SQLite DB (keys retained)"
rm -f apps/issuer/data/db.sqlite apps/issuer/data/db.sqlite-shm apps/issuer/data/db.sqlite-wal
ok "apps/issuer/data/db.sqlite removed"

# 3. Wipe deployed-addresses.json so a stale file doesn't get used while the
#    redeploy is in flight.
rm -f apps/web/lib/chain/deployed-addresses.json
ok "apps/web/lib/chain/deployed-addresses.json removed"

# 4. Start anvil in the background
step "Starting anvil"
dotenv -e .env -- bash -c '
  anvil --block-time 2 --accounts 10 --balance 100 --gas-price 0 --base-fee 0 \
    ${ANVIL_MNEMONIC:+--mnemonic "$ANVIL_MNEMONIC"} > /tmp/firmus-anvil.log 2>&1 &
  echo $! > /tmp/firmus-anvil.pid
'
sleep 3
if curl -fsS -X POST -H 'content-type: application/json' \
   --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
   http://127.0.0.1:8545 > /dev/null 2>&1; then
  ok "anvil up on :8545 (pid=$(cat /tmp/firmus-anvil.pid))"
else
  warn "anvil did not respond on :8545 — see /tmp/firmus-anvil.log"
  exit 1
fi

# 5. Redeploy contracts → fresh addresses + schema UIDs
step "Deploying contracts"
pnpm scripts:deploy > /tmp/firmus-deploy.log 2>&1
if [ -f apps/web/lib/chain/deployed-addresses.json ]; then
  ok "deployed-addresses.json written"
else
  warn "deploy script ran but deployed-addresses.json wasn't created — see /tmp/firmus-deploy.log"
  exit 1
fi

# 6. Apply Prisma migrations + run seed
step "Applying Prisma migrations + seeding apps/web"
pnpm --filter @firmus/web exec prisma migrate deploy > /dev/null
pnpm --filter @firmus/web exec prisma generate > /dev/null
pnpm --filter @firmus/web exec tsx prisma/seed.ts > /dev/null
ok "apps/web seeded"

# 7. Re-seed the issuer (creates schema via @firmus/db-toolkit migrations)
step "Seeding apps/issuer"
pnpm --filter @firmus/issuer seed > /dev/null
ok "apps/issuer seeded"

# 8. Done
echo
printf "\033[1;32m✓ Reset complete.\033[0m\n"
echo "  anvil PID: $(cat /tmp/firmus-anvil.pid)"
echo "  Run \033[1mpnpm dev\033[0m to bring up proxy + web + issuer."
