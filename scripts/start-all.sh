#!/usr/bin/env bash
# Brings up the demo stack: anvil (port 8545), platform (3010), issuer (3001),
# proxy (3000). Run `scripts/start-all-ngrok.sh` for the ngrok-fronted variant.
# Owner spec: 001-verified-legal-engagement.
#
#   bash scripts/start-all.sh                # honor DEV_BYPASS_EUDI from .env
#   bash scripts/start-all.sh --bypass       # force DEV_BYPASS_EUDI=1
#   bash scripts/start-all.sh --no-bypass    # force DEV_BYPASS_EUDI=0
#                                            # (full wwWallet flow; persona-pick disabled)
set -euo pipefail
cd "$(dirname "$0")/.."

# Resolve project env first (anvil mnemonic, public hostname, RPC, default
# DEV_BYPASS_EUDI). CLI flags below override the .env value for this run.
set -a; source .env; set +a

# Parse the bypass flag.
for arg in "$@"; do
  case "$arg" in
    --bypass)    export DEV_BYPASS_EUDI=1 ;;
    --no-bypass) export DEV_BYPASS_EUDI=0 ;;
    -h|--help)   sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (expected --bypass / --no-bypass)" >&2; exit 1 ;;
  esac
done

if [[ "${DEV_BYPASS_EUDI:-0}" == "1" ]]; then
  echo "[start-all] DEV_BYPASS_EUDI=1 — persona picker active at /dev/personas"
else
  echo "[start-all] DEV_BYPASS_EUDI=0 — full wwWallet flow only (no persona picker)"
fi

mkdir -p .run-logs

# Anvil — block-time 2 s gives demos a noticeable confirmation beat.
if ! curl -s -X POST -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
     "$RPC_URL" > /dev/null 2>&1; then
  echo "[start-all] starting anvil"
  nohup anvil --block-time 2 --accounts 10 --balance 100 --gas-price 0 \
    --base-fee 0 --mnemonic "$ANVIL_MNEMONIC" \
    > .run-logs/anvil.log 2>&1 &
  sleep 3
fi

# Deploy contracts if addresses.ts is missing.
if [[ ! -f apps/platform/lib/chain/addresses.ts ]]; then
  echo "[start-all] deploying contracts"
  bash scripts/deploy.sh
fi

# Seed the issuer's subjects roster + signing keys if the DB is missing.
if [[ ! -f apps/issuer/data/db.sqlite ]]; then
  echo "[start-all] seeding issuer roster + signing keys"
  pnpm -F @firmus-novus/issuer seed
fi

# Apps. We exported DEV_BYPASS_EUDI ourselves; dotenv-cli does NOT override
# existing env vars by default, so our explicit value wins inside `pnpm dev`.
pnpm dev
