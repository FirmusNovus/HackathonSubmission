#!/usr/bin/env bash
# Deploys all contracts to the configured RPC + writes addresses.ts.
# Owner spec: 001-verified-legal-engagement.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${OPERATOR_PRIVATE_KEY:-}" ]]; then
  echo "OPERATOR_PRIVATE_KEY missing; source .env first." >&2
  exit 1
fi
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

mkdir -p apps/platform/lib/chain
cd contracts
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast
echo "Deploy complete; addresses.ts updated."
