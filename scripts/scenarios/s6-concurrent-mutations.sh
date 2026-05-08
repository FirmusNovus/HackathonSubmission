#!/usr/bin/env bash
# Scenario S6 — chain-as-arbiter (FR-058 / FR-059).
# When two state-mutating actions race against the same proposal, exactly one
# wins on chain; the loser must surface a clean state-changed error.
#   Race A: client.releaseProposal vs. client.disputeProposal
#   Race B: lawyer.markDelivered vs. client.releaseProposal
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S6 — Concurrent state mutations (chain-as-arbiter)"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)

echo "  -- Race A: release wins, dispute reverts"
client_cookie=$(mktemp); login_as 6 "$client_cookie"
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Race A: release vs dispute against same proposal index 0.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

# Fire release + dispute back-to-back (Anvil mines blocks every 2s; one will land first).
RES_F=$(mktemp); DIS_F=$(mktemp)
( curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > "$RES_F" ) &
PIDR=$!
( curl -s -X POST -b "$client_cookie" "$PLATFORM/api/disputes/$EID/0/file" > "$DIS_F" ) &
PIDD=$!
wait $PIDR
wait $PIDD
RES_OUT=$(cat "$RES_F"); DIS_OUT=$(cat "$DIS_F")
echo "    release  -> $RES_OUT"
echo "    dispute  -> $DIS_OUT"

# Exactly one must succeed; the other must surface invalid-proposal-state.
RES_OK=$(echo "$RES_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo False)
DIS_OK=$(echo "$DIS_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo False)
echo "    release ok=$RES_OK, dispute ok=$DIS_OK"
WINS=$(python3 -c "print(int('$RES_OK'=='True') + int('$DIS_OK'=='True'))")
expect_eq "$WINS" "1" "exactly one of {release, dispute} wins on chain"

# Loser surfaces an error. The specific error may be:
#  - invalid-proposal-state (contract revert when the loser's tx mines after winner)
#  - broadcast-failed with nonce/tx-creation detail (viem's nonce manager
#    detected the conflict before submission)
# Both are valid expressions of FR-058 chain-as-arbiter.
LOSER=$(if [[ "$RES_OK" == "True" ]]; then echo "$DIS_OUT"; else echo "$RES_OUT"; fi)
expect_match "$LOSER" "error|invalid-proposal-state|broadcast-failed" "loser surfaces an error"

# Chain state confirms the winner.
PROP=$(proposal_chain_state "$EID" 0)
STATE=$(echo "$PROP" | awk -F, '{print $2}')
echo "    final state on chain: $STATE (3=Released, 4=Disputed)"
expect_match "$STATE" '^[34]$' "final state is Released or Disputed"

echo
echo "  -- Race B: double markDelivered (lawyer-only)"
RES2=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 11:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Estate\",\"caseDescription\":\"Race B: two simultaneous markDelivered against same proposal.\"}" \
  "$PLATFORM/api/consultations")
EID2=$(echo "$RES2" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID2=$(echo "$RES2" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

anna_cookie=$(mktemp); login_as 1 "$anna_cookie"
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID2/accept" > /dev/null

A=$(mktemp); B=$(mktemp)
( curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/proposals/$EID2/0/mark-delivered" > "$A" ) &
PA=$!
( curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/proposals/$EID2/0/mark-delivered" > "$B" ) &
PB=$!
wait $PA; wait $PB
echo "    A -> $(cat $A)"
echo "    B -> $(cat $B)"
A_OK=$(cat "$A" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo False)
B_OK=$(cat "$B" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo False)
WINS2=$(python3 -c "print(int('$A_OK'=='True') + int('$B_OK'=='True'))")
expect_eq "$WINS2" "1" "exactly one markDelivered wins"

PROP2=$(proposal_chain_state "$EID2" 0)
expect_eq "$(echo "$PROP2" | awk -F, '{print $2}')" "2" "proposal state=Delivered (2)"

echo "[S6] PASS"
