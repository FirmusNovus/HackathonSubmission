#!/usr/bin/env bash
# Scenario S13 — many engagements between the same client and lawyer.
# Verifies that nothing in the platform's bookkeeping limits a client to one
# engagement per lawyer (e.g. UI shouldn't accidentally cap, indexer must
# track all of them, escrow must hold each independently).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S13 — Stress: 10 engagements between same parties"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

EIDS=()
for i in 1 2 3 4 5 6 7 8 9 10; do
  RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
    --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d "+${i} day" +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Stress test engagement number ${i} for the same parties.\"}" \
    "$PLATFORM/api/consultations")
  EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
  EIDS+=("$EID")
  echo "  engagement #$i → on-chain id $EID"
done
expect_eq "${#EIDS[@]}" "10" "10 engagements created"

# Each one parks 0.012 ETH (Anna's 30-min rate).
EXPECTED_PARKED=$(python3 -c "print(10 * 12_000_000_000_000_000)")
ESC=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
echo "  escrow holds $ESC wei (expected ≥ $EXPECTED_PARKED before any release)"
python3 -c "import sys;e=int('$ESC');t=int('$EXPECTED_PARKED'); sys.exit(0 if e >= t else 1)"
echo "  ✓ escrow holds at least the sum of 10 engagements"

# Inspect each engagement on chain — all should have proposalCount=1, paid=true.
for eid in "${EIDS[@]}"; do
  ENG=$(engagement_chain_state "$eid")
  PCOUNT=$(echo "$ENG" | awk -F, '{print $6}')
  if [[ "$PCOUNT" != "1" ]]; then
    echo "[FAIL] engagement $eid: proposalCount=$PCOUNT (want 1)"; exit 1
  fi
done
echo "  ✓ all 10 engagements have proposalCount=1 on chain"

# Verify platform DB lists all 10 consultations for this client.
COUNT=$(db_query "SELECT COUNT(*) AS n FROM consultations WHERE client_id = (SELECT eth_address FROM verified_users WHERE attested_role='client' LIMIT 1)" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['n'])")
expect_match "$COUNT" '^[0-9]+$' "consultations count is numeric"
python3 -c "n=int('$COUNT'); assert n >= 10, f'expected >= 10, got {n}'; print('  ✓ DB has', n, 'consultations for this client')"

# Release all 10 (each should drop the escrow balance by exactly 0.012 ETH).
ESC_BEFORE=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
ANNA_BEFORE=$(cast balance "$ANNA" --rpc-url "$RPC_URL")
for eid in "${EIDS[@]}"; do
  CID=$(db_query "SELECT id FROM consultations WHERE engagement_id = $eid" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
  curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null
done
ANNA_AFTER=$(cast balance "$ANNA" --rpc-url "$RPC_URL")
ESC_AFTER=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")

ESC_DELTA=$(python3 -c "print(int('$ESC_BEFORE') - int('$ESC_AFTER'))")
expect_eq "$ESC_DELTA" "$EXPECTED_PARKED" "escrow drops by exactly 10 × 0.012 ETH"
ANNA_DELTA=$(python3 -c "print(int('$ANNA_AFTER') - int('$ANNA_BEFORE'))")
expect_eq "$ANNA_DELTA" "$EXPECTED_PARKED" "Anna gains exactly 10 × 0.012 ETH"

echo "[S13] PASS"
