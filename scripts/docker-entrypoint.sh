#!/usr/bin/env bash
# Container boot: anvil → deploy → migrate/seed → start apps.
# Idempotent. Restarting the container yields a fresh chain + DB.

set -euo pipefail

cd /app

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# Honour PUBLIC_HOSTNAME passed via `docker run -e PUBLIC_HOSTNAME=…`. Wallet-
# visible URLs in the issuer + verifier metadata come from this value, so it
# MUST match what the EUDI wallet (which lives outside the container) actually
# reaches. For local-only demos that's http://localhost:3000; for ngrok runs
# it's the public https://*.ngrok-free.dev URL.
if [ -n "${PUBLIC_HOSTNAME:-}" ]; then
  if grep -q '^PUBLIC_HOSTNAME=' .env; then
    sed -i "s|^PUBLIC_HOSTNAME=.*|PUBLIC_HOSTNAME=${PUBLIC_HOSTNAME}|" .env
  else
    echo "PUBLIC_HOSTNAME=${PUBLIC_HOSTNAME}" >> .env
  fi
  ok "PUBLIC_HOSTNAME set to ${PUBLIC_HOSTNAME}"
fi

# --- 1. anvil ----------------------------------------------------------------
step "Starting anvil on :8545"
# shellcheck disable=SC1091
set -a; . ./.env; set +a
anvil \
  --block-time 2 \
  --accounts 10 \
  --balance 100 \
  --gas-price 0 \
  --base-fee 0 \
  --host 0.0.0.0 \
  ${ANVIL_MNEMONIC:+--mnemonic "$ANVIL_MNEMONIC"} \
  > /tmp/anvil.log 2>&1 &
ANVIL_PID=$!

# Print the account/key list so judges can `docker logs firmus-novus` and grab
# private keys to import into MetaMask. Anvil only writes them to its own
# stdout — we re-emit the relevant chunk to stdout (= docker logs) below.

# Wait for anvil to answer JSON-RPC. Fail loudly if it never comes up.
for i in $(seq 1 40); do
  if curl -fsS -X POST -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null 2>&1; then
    ok "anvil ready (pid=${ANVIL_PID})"
    break
  fi
  sleep 0.5
  if [ "$i" = 40 ]; then
    cat /tmp/anvil.log >&2
    die "anvil failed to start within 20s"
  fi
done

# Re-emit anvil's account/key block so it's visible via `docker logs`.
sed -n '/Available Accounts/,/Listening on/p' /tmp/anvil.log || true

# --- 2. Deploy contracts -----------------------------------------------------
# Forge writes apps/web/lib/chain/deployed-addresses.json which the web app
# reads at boot. Skip if a prior run on this same chain already deployed
# (rare in container flow because we wipe state on every start).
step "Deploying contracts"
rm -f apps/web/lib/chain/deployed-addresses.json
( cd contracts && forge script script/Deploy.s.sol \
    --rpc-url "${RPC_URL:-http://127.0.0.1:8545}" --broadcast >/dev/null )
[ -f apps/web/lib/chain/deployed-addresses.json ] || die "deploy did not write deployed-addresses.json"
ok "contracts deployed"

# --- 3. SQLite migrate + seed -----------------------------------------------
step "Web DB: migrate + seed"
# Wipe any leftover dev.db (in case the image has one baked in).
rm -f apps/web/prisma/dev.db apps/web/prisma/dev.db-{journal,shm,wal}
pnpm --filter @firmus/web exec prisma migrate deploy >/dev/null
pnpm --filter @firmus/web exec tsx prisma/seed.ts >/dev/null
ok "web DB ready"

step "Issuer DB: seed"
rm -f apps/issuer/data/db.sqlite apps/issuer/data/db.sqlite-{shm,wal}
pnpm --filter @firmus/issuer seed >/dev/null
ok "issuer DB ready"

# --- 4. Apps -----------------------------------------------------------------
# Forward SIGTERM to the child process group so `docker stop` is fast.
trap 'kill -TERM "$ANVIL_PID" 2>/dev/null || true; pkill -TERM -P $$ || true' TERM INT

step "Starting proxy + web + issuer"
exec pnpm start
