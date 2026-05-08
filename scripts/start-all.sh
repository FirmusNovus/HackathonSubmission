#!/usr/bin/env bash
# Brings up the demo stack: anvil (port 8545), platform (3010), issuer (3001),
# proxy (3000). Run `scripts/start-all-ngrok.sh` for the ngrok-fronted variant.
# Owner spec: 001-verified-legal-engagement.
set -euo pipefail
cd "$(dirname "$0")/.."

# Resolve project env (anvil mnemonic, public hostname, RPC).
set -a; source .env; set +a

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

# Apps.
pnpm dev
