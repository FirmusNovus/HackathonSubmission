#!/usr/bin/env bash
# Scenario S3 — lawyer declines a PAID consultation, refund flow runs.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S3 — Lawyer declines PAID (refund)"
require_services
reset_platform

DIETER=$(lawyer_addr dieter-mueller)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$DIETER\",\"scheduledAt\":$(date -d 'tomorrow 19:00' +%s),\"durationMinutes\":60,\"practiceArea\":\"Employment\",\"caseDescription\":\"Hoping Dieter declines so we test the refund path.\"}" \
  "$PLATFORM/api/consultations")
echo "  book: $RES"
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

CLIENT_ADDR=$(curl -s -b "$client_cookie" "$PLATFORM/api/auth/siwe/session" | python3 -c "import json,sys;print(json.load(sys.stdin)['session']['address'])")
ESC_BEFORE=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
CLIENT_BEFORE=$(cast balance "$CLIENT_ADDR" --rpc-url "$RPC_URL")

# Lawyer declines.
dieter_cookie=$(mktemp); login_as 3 "$dieter_cookie"
DEC=$(curl -s -X POST -b "$dieter_cookie" "$PLATFORM/api/consultations/$CID/decline")
echo "  decline: $DEC"
expect_match "$DEC" "ok.*true" "decline ok"

# Lawyer's decline created a refund auth row with no signatures yet. Pull the nonce.
ROW=$(db_query "SELECT nonce FROM mutual_refund_authorizations WHERE engagement_id = $EID AND broadcast_tx_hash IS NULL ORDER BY id DESC LIMIT 1")
NONCE=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['nonce'])")
expect_match "$NONCE" '^0x[a-f0-9]{64}$' "refund nonce stored after decline"

# Both sigs.
SIG_LAWYER=$(curl -s -X POST -H "Content-Type: application/json" -b "$dieter_cookie" \
  --data "{\"engagementId\":$EID,\"proposalIndex\":0,\"nonce\":\"$NONCE\"}" "$PLATFORM/api/dev/sign-refund" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['signature'])")
curl -s -X POST -H "Content-Type: application/json" -b "$dieter_cookie" \
  --data "{\"signature\":\"$SIG_LAWYER\",\"nonce\":\"$NONCE\"}" "$PLATFORM/api/proposals/$EID/0/mutual-refund/initiate" > /dev/null

login_as 6 "$client_cookie"
SIG_CLIENT=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"engagementId\":$EID,\"proposalIndex\":0,\"nonce\":\"$NONCE\"}" "$PLATFORM/api/dev/sign-refund" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['signature'])")
INIT_FINAL=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"signature\":\"$SIG_CLIENT\",\"nonce\":\"$NONCE\"}" "$PLATFORM/api/proposals/$EID/0/mutual-refund/initiate")
expect_match "$INIT_FINAL" "bothSigsPresent.*true" "both signatures present"

BC=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/proposals/$EID/0/mutual-refund/broadcast")
TX=$(echo "$BC" | python3 -c "import json,sys;print(json.load(sys.stdin).get('txHash',''))")
expect_match "$TX" '^0x[a-fA-F0-9]{64}$' "broadcast tx"

PROP=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP" | awk -F, '{print $2}')" "6" "proposal state=Refunded (6)"

ESC_AFTER=$(cast balance "$ESCROW" --rpc-url "$RPC_URL")
ESC_DELTA=$(python3 -c "print(int('$ESC_BEFORE') - int('$ESC_AFTER'))")
expect_eq "$ESC_DELTA" "34000000000000000" "escrow dropped by 0.034 ETH (60-min Dieter rate)"

echo "[S3] PASS"
