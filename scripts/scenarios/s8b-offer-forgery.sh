#!/usr/bin/env bash
# Scenario S8b — forged ProposalOffer signature MUST be rejected by the contract.
# Constitution Inv 6 / Inv 2: capability checks are contract-enforced.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S8b — Forged ProposalOffer signature rejected"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

# Setup: PAID consultation released so the engagement is Active with proposalCount=1.
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Setup engagement to test forged offer rejection.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null

# Now broadcast fundProposal directly via cast with a garbage signature.
set -a; source "$ROOT/.env"; set +a
ITEMS_HASH="0x$(printf 'a%.0s' {1..64})"
NONCE="0x$(printf 'b%.0s' {1..64})"
GARBAGE_SIG="0x$(printf '0%.0s' {1..130})"

# Get client's private key (anvil index 6).
CLIENT_PK=$(cast wallet private-key --mnemonic "$ANVIL_MNEMONIC" --mnemonic-index 6)

# Try to fund 0.01 ETH with a garbage signature — must revert.
echo "  -- attempting fundProposal with all-zero signature (should revert with InvalidOfferSignature)"
OUT=$(cast send "$ESCROW" \
  "fundProposal(uint256,uint256,bytes32,bytes32,bytes)" \
  "$EID" 10000000000000000 "$ITEMS_HASH" "$NONCE" "$GARBAGE_SIG" \
  --value 10000000000000000 \
  --rpc-url "$RPC_URL" \
  --private-key "$CLIENT_PK" 2>&1 || true)
echo "$OUT" | head -3
expect_match "$OUT" "InvalidOfferSignature|ECDSAInvalidSignature|reverted|revert" "garbage signature reverts"

echo "[S8b] PASS"
