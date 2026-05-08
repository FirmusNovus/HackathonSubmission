#!/usr/bin/env bash
# Scenario S12 — FREE consultation + PAID follow-up proposal.
# A FREE engagement starts with proposalCount=0. The lawyer can then issue
# a signed PROPOSAL artifact at index 0; the client funds, etc. This proves
# free intro consultations smoothly transition to paid work.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S12 — FREE consultation + PAID follow-up"
require_services
reset_platform

LUCIA=$(lawyer_addr lucia-romero)  # FREE consultation
client_cookie=$(mktemp); login_as 6 "$client_cookie"
lucia_cookie=$(mktemp); login_as 3 "$lucia_cookie"

RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$LUCIA\",\"scheduledAt\":$(date -d 'tomorrow 14:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Property\",\"caseDescription\":\"Free intro to discuss Spanish property purchase paperwork.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

ENG=$(engagement_chain_state "$EID")
expect_eq "$(echo "$ENG" | awk -F, '{print $6}')" "0" "FREE: proposalCount=0 at open"
expect_eq "$(echo "$ENG" | awk -F, '{print $7}')" "false" "FREE: consultationPaid=false"

# Lucia accepts + client marks complete (off-chain only).
curl -s -X POST -b "$lucia_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null

# Lucia issues a follow-up Proposal: 0.04 ETH for full property review.
ISSUE=$(curl -s -X POST -H "Content-Type: application/json" -b "$lucia_cookie" \
  --data "{\"engagementId\":$EID,\"lineItems\":[{\"id\":\"a\",\"title\":\"Title check + sale-contract review\",\"kind\":\"fixed\",\"fixedPrice\":\"40000000000000000\",\"subtotal\":\"40000000000000000\"}],\"deliverables\":[{\"id\":\"d\",\"title\":\"Memo on title + risks\"}]}" \
  "$PLATFORM/api/proposals")
IDX=$(echo "$ISSUE" | python3 -c "import json,sys;print(json.load(sys.stdin)['proposalIndex'])")
expect_eq "$IDX" "0" "first paid proposal sits at index 0 in a FREE engagement"

# Client funds.
FUND=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/$IDX/fund")
expect_match "$FUND" "ok.*true" "client funds paid follow-up"
PROP=$(proposal_chain_state "$EID" "$IDX")
expect_eq "$(echo "$PROP" | awk -F, '{print $1}')" "40000000000000000" "amount = 0.04 ETH"
expect_eq "$(echo "$PROP" | awk -F, '{print $2}')" "1" "state=Funded"

# Lucia delivers, client releases.
curl -s -X POST -b "$lucia_cookie" "$PLATFORM/api/proposals/$EID/$IDX/mark-delivered" > /dev/null
LUCIA_BEFORE=$(cast balance "$LUCIA" --rpc-url "$RPC_URL")
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/$IDX/release" > /dev/null
LUCIA_AFTER=$(cast balance "$LUCIA" --rpc-url "$RPC_URL")
DELTA=$(python3 -c "print(int('$LUCIA_AFTER') - int('$LUCIA_BEFORE'))")
expect_eq "$DELTA" "40000000000000000" "Lucia received exactly 0.04 ETH on release"

PROPF=$(proposal_chain_state "$EID" "$IDX")
expect_eq "$(echo "$PROPF" | awk -F, '{print $2}')" "3" "final state=Released"

echo "[S12] PASS"
