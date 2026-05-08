#!/usr/bin/env bash
# Scenario S15 — direct chain interactions that bypass the platform must NOT
# be able to break invariants. Specifically:
#  - non-operator calling resolveDispute MUST revert
#  - non-engagement-party calling closeEngagement MUST revert
#  - lawyer calling releaseProposal MUST revert (client-only)
#  - non-attested address calling openFreeEngagement MUST revert
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S15 — Contract guards against direct-chain tampering"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

# Seed a working PAID consultation.
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Will be poked at by direct cast calls.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")

set -a; source "$ROOT/.env"; set +a
ANNA_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 1)
CLIENT_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 6)

echo "  -- lawyer calling releaseProposal MUST revert (client-only)"
TX=$(cast send "$ESCROW" "releaseProposal(uint256,uint256)" "$EID" 0 \
  --rpc-url "$RPC_URL" --private-key "$ANNA_PK" 2>&1 || true)
expect_match "$TX" "NotEngagementClient|reverted|0xb7f6c7da" "lawyer cannot release client's proposal"

echo
echo "  -- client calling escalateProposal MUST revert (lawyer-only)"
# First markDelivered so escalation is at least state-eligible.
cast send "$ESCROW" "markDelivered(uint256,uint256)" "$EID" 0 \
  --rpc-url "$RPC_URL" --private-key "$ANNA_PK" > /dev/null
TX=$(cast send "$ESCROW" "escalateProposal(uint256,uint256,bytes32)" "$EID" 0 "0x$(openssl rand -hex 32)" \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || true)
expect_match "$TX" "NotEngagementLawyer|reverted|0x3a3df0b6" "client cannot escalate"

echo
echo "  -- non-operator calling resolveDispute MUST revert"
# First the client disputes legitimately.
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/disputes/$EID/0/file" > /dev/null
TX=$(cast send "$ESCROW" "resolveDispute(uint256,uint256,uint256,uint256)" "$EID" 0 6000000000000000 6000000000000000 \
  --rpc-url "$RPC_URL" --private-key "$CLIENT_PK" 2>&1 || true)
expect_match "$TX" "OnlyOperator|reverted|0x47812f70" "non-operator cannot resolve"

echo
echo "  -- non-engagement-party calling closeEngagement MUST revert"
STRANGER_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 5)
TX=$(cast send "$ESCROW" "closeEngagement(uint256,bytes32)" "$EID" "0x$(openssl rand -hex 32)" \
  --rpc-url "$RPC_URL" --private-key "$STRANGER_PK" 2>&1 || true)
expect_match "$TX" "NotEngagementParty|reverted|0x5dc79ed3" "stranger cannot close someone's engagement"

echo
echo "  -- non-attested wallet calling openFreeEngagement MUST revert (NotVerifiedClient)"
NEW_PK=$(cast wallet new --json | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['private_key'])")
NEW_ADDR=$(cast wallet address --private-key "$NEW_PK")
# Fund this wallet so it can pay gas.
cast send "$NEW_ADDR" --value 1ether --rpc-url "$RPC_URL" --private-key "$ANNA_PK" > /dev/null
TX=$(cast send "$ESCROW" "openFreeEngagement(address,bytes32,bytes,bytes32,bytes32)" \
  "$ANNA" "0x$(openssl rand -hex 32)" "0xc0ffee" "0x$(openssl rand -hex 32)" "0x$(openssl rand -hex 32)" \
  --rpc-url "$RPC_URL" --private-key "$NEW_PK" 2>&1 || true)
expect_match "$TX" "NotVerifiedClient|reverted|0xc11ee84f" "unattested wallet cannot open engagement"

echo "[S15] PASS"
