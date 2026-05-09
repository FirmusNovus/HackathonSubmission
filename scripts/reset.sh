#!/usr/bin/env bash
# Reset every piece of state for a clean demo run.
# Owner spec: 001-verified-legal-engagement.
#
#   bash scripts/reset.sh              # full reset: anvil + all DBs + redeploy + reseed
#   bash scripts/reset.sh --soft       # only wipe platform DB tables (chain preserved)
#   bash scripts/reset.sh --keep-keys  # full reset but preserve issuer signing keys + verifier cert
#                                      # (so wallets that cached metadata don't break)
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="full"
KEEP_KEYS=0
for arg in "$@"; do
  case "$arg" in
    --soft) MODE="soft" ;;
    --keep-keys) KEEP_KEYS=1 ;;
    -h|--help)
      sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

set -a; source .env; set +a

if [[ "$MODE" == "soft" ]]; then
  echo "[reset] soft — POST /api/dev/reset (platform DB only)"
  if curl -s -X POST http://127.0.0.1:3010/api/dev/reset | grep -q '"ok":true'; then
    echo "[reset] platform DB cleared. Chain + issuer DB preserved."
  else
    echo "[reset] /api/dev/reset failed — is the platform running on :3010?" >&2
    exit 1
  fi
  exit 0
fi

# Full reset.
echo "[reset] killing apps + anvil + ngrok"
pkill -f "next-server|next dev|firmus-novus/proxy|tsx watch" 2>/dev/null || true
pkill -f "^anvil" 2>/dev/null || true
sleep 1

echo "[reset] wiping app data dirs"
if [[ "$KEEP_KEYS" == "1" ]]; then
  # Preserve signing keys + verifier cert; wipe DBs and uploads only.
  rm -f apps/platform/data/db.sqlite* 2>/dev/null || true
  rm -rf apps/platform/data/uploads 2>/dev/null || true
  rm -f apps/issuer/data/db.sqlite* 2>/dev/null || true
else
  rm -rf apps/platform/data apps/issuer/data
fi
rm -f apps/platform/lib/chain/addresses.ts

echo "[reset] restarting anvil"
mkdir -p .run-logs
nohup anvil --block-time 2 --accounts 10 --balance 100 --gas-price 0 \
  --base-fee 0 --mnemonic "$ANVIL_MNEMONIC" \
  > .run-logs/anvil.log 2>&1 &

# Wait for anvil to come up.
for i in $(seq 1 20); do
  if curl -s -X POST -H "Content-Type: application/json" \
       --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
       "$RPC_URL" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[reset] redeploying contracts"
bash scripts/deploy.sh

echo "[reset] re-seeding issuer roster + signing keys"
pnpm -F @firmus-novus/issuer seed > /dev/null

echo
echo "[reset] done. Chain redeployed; both DBs fresh; issuer roster reseeded."
echo "        Run \`bash scripts/start-all-ngrok.sh\` to bring the apps back up."
