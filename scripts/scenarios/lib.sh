#!/usr/bin/env bash
# Owner spec: 001-verified-legal-engagement.
# Helpers shared by every scenario script.

set -euo pipefail

PLATFORM=${PLATFORM:-http://127.0.0.1:3010}
ROOT=${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}

# Returns 0 if all running services are healthy, prints diagnostics if not.
require_services() {
  curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://127.0.0.1:8545 > /dev/null 2>&1 \
    || { echo "anvil not reachable" >&2; return 1; }
  curl -s -o /dev/null -w "%{http_code}" "$PLATFORM/" | grep -q 200 \
    || { echo "platform not reachable on $PLATFORM" >&2; return 1; }
}

# Resets the platform DB. Must be called before any scenario that asserts on
# initial state. Re-seeds the 6 personas after.
reset_platform() {
  curl -s -X POST "$PLATFORM/api/dev/reset" > /dev/null
  for p in 1 2 3 4 5 6; do
    curl -s -X POST -H "Content-Type: application/json" \
      --data "{\"persona\":$p}" "$PLATFORM/api/dev/login" > /dev/null
  done
}

# Login as a persona. Stores the session cookie at the file path passed in.
login_as() {
  local persona=$1 cookie=$2
  curl -s -X POST -H "Content-Type: application/json" \
    --data "{\"persona\":$persona}" -c "$cookie" "$PLATFORM/api/dev/login" \
    > /dev/null
}

# Returns the wallet address for the given lawyer slug.
lawyer_addr() {
  local slug=$1
  curl -s "$PLATFORM/api/lawyers" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((l['walletAddress'] for l in d['lawyers'] if l['slug']==sys.argv[1]),''))" "$slug"
}

# Asserts that two strings are equal. Aborts the scenario otherwise.
expect_eq() {
  local got=$1 want=$2 label=$3
  if [[ "$got" != "$want" ]]; then
    echo "[FAIL] $label: got '$got', want '$want'" >&2
    exit 1
  fi
  echo "  ✓ $label"
}

# Assert that a value matches a regex.
expect_match() {
  local got=$1 pattern=$2 label=$3
  if ! [[ "$got" =~ $pattern ]]; then
    echo "[FAIL] $label: got '$got', want pattern '$pattern'" >&2
    exit 1
  fi
  echo "  ✓ $label"
}

# Print a section banner.
banner() {
  echo
  echo "=========================================================="
  echo "  $1"
  echo "=========================================================="
}

# Run a query against the platform DB. Outputs JSON rows on stdout.
# (better-sqlite3 must resolve from apps/platform/, so we write the helper
#  there and cd in to run it.)
db_query() {
  local sql=$1
  local q="$ROOT/apps/platform/.scenario-q.mjs"
  cat > "$q" <<EOF
import Database from 'better-sqlite3';
const db = new Database('data/db.sqlite', { readonly: true });
console.log(JSON.stringify(db.prepare(\`$sql\`).all()));
EOF
  (cd "$ROOT/apps/platform" && node .scenario-q.mjs)
  rm -f "$q"
}

# Direct chain reads via cast.
ESCROW=$(grep legalEngagementEscrow "$ROOT/apps/platform/lib/chain/addresses.ts" | sed -E "s/.*'(.*)'.*/\1/")
AM=$(grep attestationManager "$ROOT/apps/platform/lib/chain/addresses.ts" | sed -E "s/.*'(.*)'.*/\1/")
SCHEMA_LAWYER=$(grep "lawyer:" "$ROOT/apps/platform/lib/chain/addresses.ts" | sed -E "s/.*'(.*)'.*/\1/")
SCHEMA_CLIENT=$(grep "client:" "$ROOT/apps/platform/lib/chain/addresses.ts" | sed -E "s/.*'(.*)'.*/\1/")
RPC_URL=${RPC_URL:-http://127.0.0.1:8545}

# Read a proposal struct from the chain. Returns "amount,state,deliveredAt,toLawyer,toClient".
proposal_chain_state() {
  local engId=$1 propIdx=$2
  # cast formats large uints like "12000000000000000 [1.2e16]" — strip the bracket.
  cast call "$ESCROW" "getProposal(uint256,uint256)((uint256,uint8,uint64,uint256,uint256))" \
    "$engId" "$propIdx" --rpc-url "$RPC_URL" 2>/dev/null \
    | sed -E 's/[[:space:]]+\[[^]]+\]//g; s/[() ]//g'
}

# Read an engagement struct. Returns "client,lawyer,matterRef,state,root,proposalCount,paid".
engagement_chain_state() {
  local engId=$1
  cast call "$ESCROW" "getEngagement(uint256)((address,address,bytes32,uint8,bytes32,uint256,bool))" \
    "$engId" --rpc-url "$RPC_URL" 2>/dev/null \
    | sed -E 's/[[:space:]]+\[[^]]+\]//g; s/[() ]//g'
}

# Capability check.
has_capability() {
  local addr=$1 schema=$2
  cast call "$AM" "hasCapability(address,bytes32)(bool)" "$addr" "$schema" --rpc-url "$RPC_URL"
}
