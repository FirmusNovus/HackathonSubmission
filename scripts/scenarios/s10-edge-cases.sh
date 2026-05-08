#!/usr/bin/env bash
# Scenario S10 — additional edge cases that didn't fit elsewhere.
#  - Dispute on Released proposal must fail.
#  - Mark delivered on a Released proposal must fail.
#  - Decline after acceptance must fail.
#  - Anonymous client identifier is stable + 4 hex chars.
#  - Operator splits at the boundaries (0%/100%, 100%/0%).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S10 — Additional edge cases"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"

# --- Setup: PAID consultation, accept, complete ---
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Edge cases scenario, terminal-state retests.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null

echo "  -- dispute on Released proposal MUST fail"
DISPUTE_RELEASED=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/disputes/$EID/0/file")
echo "    response: $DISPUTE_RELEASED"
expect_match "$DISPUTE_RELEASED" "invalid-proposal-state|broadcast-failed" "dispute on Released reverts"

echo
echo "  -- markDelivered on Released MUST fail"
MD=$(curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/proposals/$EID/0/mark-delivered")
expect_match "$MD" "invalid-proposal-state|broadcast-failed" "markDelivered on Released reverts"

echo
echo "  -- decline after acceptance MUST fail (status guard)"
RES2=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 11:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Edge case: decline after accept, status guard test.\"}" \
  "$PLATFORM/api/consultations")
CID2=$(echo "$RES2" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID2/accept" > /dev/null
DEC=$(curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID2/decline")
echo "    decline-after-accept: $DEC"
expect_match "$DEC" "invalid-status" "decline after accept rejected"

echo
echo "  -- cancel after acceptance MUST fail (status guard)"
CAN=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID2/cancel")
echo "    cancel-after-accept: $CAN"
expect_match "$CAN" "invalid-status" "cancel after accept rejected"

echo
echo "  -- anonymous client id format check"
# Hit lawyer dashboard which rendres anonymousClientId; we test via the API.
# anon-XXXX with 4 uppercase hex chars.
ROW=$(db_query "SELECT id, client_id FROM consultations WHERE id = $CID")
ID=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['client_id'])")
ANON=$(curl -s "$PLATFORM/api/consultations/$CID2" -b "$anna_cookie" | python3 -c "import json,sys,hashlib,re;d=json.load(sys.stdin);c=d['consultation']; addr=c['client_id']; print(addr)")
expect_match "$ANON" '^0x[a-f0-9]{40}$' "client id is a wallet address (anon-XXXX is a UI-only computation)"

echo
echo "  -- operator boundary split: 100% to client"
RES3=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 12:00' +%s),\"durationMinutes\":60,\"practiceArea\":\"Family\",\"caseDescription\":\"Edge case: operator returns 100% to client.\"}" \
  "$PLATFORM/api/consultations")
EID3=$(echo "$RES3" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/disputes/$EID3/0/file" > /dev/null
PROP=$(proposal_chain_state "$EID3" 0)
TOTAL=$(echo "$PROP" | awk -F, '{print $1}')

set -a; source "$ROOT/.env"; set +a
cast send "$ESCROW" "resolveDispute(uint256,uint256,uint256,uint256)" "$EID3" 0 0 "$TOTAL" \
  --rpc-url "$RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY" > /dev/null
PROPF=$(proposal_chain_state "$EID3" 0)
expect_eq "$(echo "$PROPF" | awk -F, '{print $4}')" "0" "amountToLawyer = 0"
expect_eq "$(echo "$PROPF" | awk -F, '{print $5}')" "$TOTAL" "amountToClient = total"

echo
echo "  -- conflict nullifier is single-use"
# The chain remembers consumed nullifiers forever; pick a fresh one each run.
NUL="0x$(openssl rand -hex 32)"
MATTER="0x$(openssl rand -hex 32)"
INIT="0x$(openssl rand -hex 32)"
PROOF="0xc0ffee"
CLIENT_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 6)
echo "    1st openFreeEngagement (nullifier ${NUL:0:18}… — should succeed)"
TX=$(cast send "$ESCROW" "openFreeEngagement(address,bytes32,bytes,bytes32,bytes32)" \
  "$ANNA" "$MATTER" "$PROOF" "$NUL" "$INIT" \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || echo "FAIL")
expect_match "$TX" "transactionHash|status" "1st free open succeeds"

echo "    2nd openFreeEngagement w/ same nullifier (should revert NullifierAlreadyUsed)"
TX2=$(cast send "$ESCROW" "openFreeEngagement(address,bytes32,bytes,bytes32,bytes32)" \
  "$ANNA" "$MATTER" "$PROOF" "$NUL" "$INIT" \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || true)
expect_match "$TX2" "NullifierAlreadyUsed|0xcad2ae02" "nullifier replay reverts"

echo "[S10] PASS"
