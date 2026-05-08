#!/usr/bin/env bash
# Scenario S2 — client cancels a PAID consultation before the lawyer accepts.
# Spec FR-015b: cancellation initiates a mutual-refund flow that requires
# both parties' EIP-712 sigs over the parked proposal.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S2 — Cancel before accept (PAID)"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

# Book a PAID 30-min consultation (0.012 ETH).
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Will cancel before Anna gets to it.\"}" \
  "$PLATFORM/api/consultations")
echo "  book: $RES"
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

# Capture balances after this engagement's funding (chain state from earlier
# scenarios may persist; we assert deltas, not absolute amounts).
ANNA_BEFORE=$(cast balance "$ANNA" --rpc-url "$RPC_URL")
CLIENT_ADDR=$(curl -s -b "$client_cookie" "$PLATFORM/api/auth/siwe/session" | python3 -c "import json,sys;print(json.load(sys.stdin)['session']['address'])")
CLIENT_BEFORE=$(cast balance "$CLIENT_ADDR" --rpc-url "$RPC_URL")
ESC_BEFORE=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
echo "  pre-refund: client=$CLIENT_BEFORE lawyer=$ANNA_BEFORE escrow=$ESC_BEFORE"

# Verify the proposal struct directly: Funded, amount=0.012 ETH.
PROP_BEFORE=$(proposal_chain_state "$EID" 0)
PROP_AMOUNT=$(echo "$PROP_BEFORE" | awk -F, '{print $1}')
PROP_STATE=$(echo "$PROP_BEFORE" | awk -F, '{print $2}')
expect_eq "$PROP_AMOUNT" "12000000000000000" "this proposal parked 0.012 ETH"
expect_eq "$PROP_STATE" "1" "this proposal state=Funded (1) before refund"

# Client cancels. Refund flow row should be created with no sigs yet.
CANCEL=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/cancel")
echo "  cancel: $CANCEL"
NONCE=$(echo "$CANCEL" | python3 -c "import json,sys;print(json.load(sys.stdin)['nonce'])")
expect_match "$NONCE" '^0x[a-f0-9]{64}$' "refund nonce returned"

ROW=$(db_query "SELECT status FROM consultations WHERE id = $CID")
expect_eq "$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")" "CANCELLED" "consultation status CANCELLED"

# Both parties sign + initiate.
echo
echo "  -- client signs typed data and initiates"
SIG_CLIENT=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"engagementId\":$EID,\"proposalIndex\":0,\"nonce\":\"$NONCE\"}" \
  "$PLATFORM/api/dev/sign-refund" | python3 -c "import json,sys;print(json.load(sys.stdin)['signature'])")
INIT_CLIENT=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"signature\":\"$SIG_CLIENT\",\"nonce\":\"$NONCE\"}" \
  "$PLATFORM/api/proposals/$EID/0/mutual-refund/initiate")
echo "    initiate: $INIT_CLIENT"

echo "  -- lawyer signs typed data and initiates"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"
SIG_LAWYER=$(curl -s -X POST -H "Content-Type: application/json" -b "$anna_cookie" \
  --data "{\"engagementId\":$EID,\"proposalIndex\":0,\"nonce\":\"$NONCE\"}" \
  "$PLATFORM/api/dev/sign-refund" | python3 -c "import json,sys;print(json.load(sys.stdin)['signature'])")
INIT_LAWYER=$(curl -s -X POST -H "Content-Type: application/json" -b "$anna_cookie" \
  --data "{\"signature\":\"$SIG_LAWYER\",\"nonce\":\"$NONCE\"}" \
  "$PLATFORM/api/proposals/$EID/0/mutual-refund/initiate")
echo "    initiate: $INIT_LAWYER"

# Anyone can broadcast; the client will.
echo
echo "  -- broadcast"
BC=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/0/mutual-refund/broadcast")
echo "    broadcast: $BC"
TX=$(echo "$BC" | python3 -c "import json,sys;print(json.load(sys.stdin).get('txHash',''))")
expect_match "$TX" '^0x[a-fA-F0-9]{64}$' "broadcast tx hash"

# Verify chain state — this proposal is Refunded, escrow drops by 0.012 ETH,
# and the client recovers ~0.012 ETH (minus gas they paid to broadcast).
PROP=$(proposal_chain_state "$EID" 0)
STATE=$(echo "$PROP" | awk -F, '{print $2}')
expect_eq "$STATE" "6" "proposal state=Refunded (6)"

ESC_AFTER=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
ESC_DELTA=$(python3 -c "print(int('$ESC_BEFORE') - int('$ESC_AFTER'))")
expect_eq "$ESC_DELTA" "12000000000000000" "escrow balance dropped by exactly 0.012 ETH"

CLIENT_AFTER=$(cast balance "$CLIENT_ADDR" --rpc-url "$RPC_URL")
DELTA=$(python3 -c "print(int('$CLIENT_AFTER') - int('$CLIENT_BEFORE'))")
echo "  client balance delta after refund: $DELTA wei"
# Anvil's gas-price 0 + base-fee 0 still passes some priority fees through; the
# client just paid for the broadcast tx as well. Accept any delta within ~1.5%
# of the parked amount.
python3 -c "d=int('$DELTA'); assert 11_800_000_000_000_000 <= d <= 12_000_000_000_000_000, f'unexpected delta {d}'; print('  ✓ delta in expected range')"

echo "[S2] PASS"
