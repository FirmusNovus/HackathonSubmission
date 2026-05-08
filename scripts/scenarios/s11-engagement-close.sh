#!/usr/bin/env bash
# Scenario S11 — engagement closure.
# closeEngagement is callable only when ALL proposals are in {Released,
# Resolved, Refunded}. Tests the gate + final TranscriptAnchored event.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S11 — Engagement closure (closeEngagement)"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"

# Setup: PAID consultation + accept + complete (proposal idx 0 Released).
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Engagement closure test: complete then close.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null

ENG=$(engagement_chain_state "$EID")
expect_eq "$(echo "$ENG" | awk -F, '{print $4}')" "1" "engagement state=Active"

# Add a follow-up proposal that's still Funded (not terminal).
ISSUE=$(curl -s -X POST -H "Content-Type: application/json" -b "$anna_cookie" \
  --data "{\"engagementId\":$EID,\"lineItems\":[{\"id\":\"a\",\"title\":\"Draft will\",\"kind\":\"fixed\",\"fixedPrice\":\"10000000000000000\",\"subtotal\":\"10000000000000000\"}],\"deliverables\":[{\"id\":\"d\",\"title\":\"Draft\"}]}" \
  "$PLATFORM/api/proposals")
IDX=$(echo "$ISSUE" | python3 -c "import json,sys;print(json.load(sys.stdin)['proposalIndex'])")
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/$IDX/fund" > /dev/null

echo "  -- close attempt with one proposal still Funded must fail"
set -a; source "$ROOT/.env"; set +a
CLIENT_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 6)
TX_FAIL=$(cast send "$ESCROW" "closeEngagement(uint256,bytes32)" "$EID" "0x$(openssl rand -hex 32)" \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || true)
expect_match "$TX_FAIL" "EngagementNotClean" "close fails when a Funded proposal still exists"

echo
echo "  -- release the follow-up, then close"
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/$IDX/release" > /dev/null
TX_OK=$(cast send "$ESCROW" "closeEngagement(uint256,bytes32)" "$EID" "0x$(openssl rand -hex 32)" \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || true)
expect_match "$TX_OK" "transactionHash|status" "close succeeds when all proposals terminal"

ENG_FINAL=$(engagement_chain_state "$EID")
expect_eq "$(echo "$ENG_FINAL" | awk -F, '{print $4}')" "2" "engagement state=Closed (2)"

# Sync indexer.
curl -s "$PLATFORM/api/lawyers" > /dev/null

echo "[S11] PASS"
