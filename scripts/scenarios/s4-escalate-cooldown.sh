#!/usr/bin/env bash
# Scenario S4 — lawyer escalation, 30-day cooldown.
# 1) PAID consultation funded
# 2) Lawyer marks delivered
# 3) Lawyer attempts to escalate before cooldown — must fail on chain
# 4) Anvil time-skip 30 days via /api/dev/skip-time
# 5) Lawyer escalates — succeeds
# 6) Operator resolves 100% to lawyer; verify chain state.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S4 — Lawyer escalation, 30-day cooldown"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 16:00' +%s),\"durationMinutes\":60,\"practiceArea\":\"Estate\",\"caseDescription\":\"Lawyer needs to escalate after 30 days, demonstrating cooldown.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
echo "  booked engagement #$EID"

# Anna accepts and marks delivered.
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null

MD=$(curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/proposals/$EID/0/mark-delivered")
echo "  markDelivered: $MD"
expect_match "$MD" "ok.*true" "markDelivered ok"
PROP=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP" | awk -F, '{print $2}')" "2" "proposal state=Delivered (2)"

# Try to escalate immediately — must fail on chain.
echo "  -- escalate before cooldown (should fail) --"
EARLY=$(curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/disputes/$EID/0/escalate" || true)
echo "    early escalate: $EARLY"
expect_match "$EARLY" "broadcast-failed|CooldownNotElapsed|reverted|InvalidProposalState" "early escalate reverts on chain"

PROP_AFTER_EARLY=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP_AFTER_EARLY" | awk -F, '{print $2}')" "2" "proposal still Delivered after failed escalate"

# Skip 30 days + 1 second.
echo "  -- skip time 30 days + 1 second --"
SKIP=$(curl -s -X POST -H "Content-Type: application/json" -b "$anna_cookie" \
  --data '{"seconds":2592001}' "$PLATFORM/api/dev/skip-time")
echo "    skip: $SKIP"
expect_match "$SKIP" "ok.*true" "evm_increaseTime ok"

# Now escalate — should succeed.
LATE=$(curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/disputes/$EID/0/escalate")
echo "  escalate after cooldown: $LATE"
expect_match "$LATE" "ok.*true" "escalate succeeds at +30 days"

PROP_DISPUTED=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP_DISPUTED" | awk -F, '{print $2}')" "4" "proposal state=Disputed (4)"

# Operator resolves 100% to the lawyer via the platform API (operator persona
# 0 is now dev-bypass loginable).
TOTAL=$(echo "$PROP_DISPUTED" | awk -F, '{print $1}')
echo "  parked: $TOTAL wei → resolving 100% to lawyer (via /api/operator)"
op_cookie=$(mktemp); login_as 0 "$op_cookie"
RESV=$(curl -s -X POST -H "Content-Type: application/json" -b "$op_cookie" \
  --data "{\"toLawyer\":\"$TOTAL\",\"toClient\":\"0\"}" \
  "$PLATFORM/api/operator/disputes/$EID/0/resolve")
expect_match "$RESV" "ok.*true" "operator resolveDispute via API"
PROP_FINAL=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP_FINAL" | awk -F, '{print $2}')" "5" "proposal state=Resolved (5)"
expect_eq "$(echo "$PROP_FINAL" | awk -F, '{print $4}')" "$TOTAL" "amountToLawyer = total"
expect_eq "$(echo "$PROP_FINAL" | awk -F, '{print $5}')" "0" "amountToClient = 0"

echo "[S4] PASS"
