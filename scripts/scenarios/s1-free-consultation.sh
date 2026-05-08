#!/usr/bin/env bash
# Scenario S1 — FREE consultation flow.
# Lucia Romero (persona 3) offers FREE 30-min consultations.
# A client books, Lucia accepts, client marks complete.
# No on-chain funds move; engagement opens with proposalCount=0,
# consultationPaid=false; consultation row carries fee_wei=0.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S1 — FREE consultation"
require_services
reset_platform

LUCIA=$(lawyer_addr lucia-romero)
expect_match "$LUCIA" '^0x[a-fA-F0-9]{40}$' "Lucia address resolved"

# Client books a free consultation.
client_cookie=$(mktemp)
login_as 6 "$client_cookie"
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$LUCIA\",\"scheduledAt\":$(date -d 'tomorrow 14:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Property\",\"caseDescription\":\"Need a free intro on cross-border property purchase in Spain.\"}" \
  "$PLATFORM/api/consultations")
echo "  POST /api/consultations: $RES"
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

# Verify chain state for this engagement.
ENG=$(engagement_chain_state "$EID")
echo "  chain engagement: $ENG"
PCOUNT=$(echo "$ENG" | awk -F, '{print $6}')
PAID=$(echo "$ENG" | awk -F, '{print $7}')
expect_eq "$PCOUNT" "0" "engagement.proposalCount=0 (no on-chain proposal for FREE)"
expect_eq "$PAID" "false" "engagement.consultationPaid=false"

# Verify off-chain consultation row.
ROW=$(db_query "SELECT consultation_kind, consultation_fee_wei, status FROM consultations WHERE id = $CID")
KIND=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['consultation_kind'])")
FEE=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['consultation_fee_wei'])")
STATUS=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
expect_eq "$KIND" "FREE" "consultation_kind=FREE"
expect_eq "$FEE" "0" "consultation_fee_wei=0"
expect_eq "$STATUS" "REQUESTED" "consultation_status=REQUESTED"

# Lucia accepts.
lucia_cookie=$(mktemp)
login_as 3 "$lucia_cookie"
ACC=$(curl -s -X POST -b "$lucia_cookie" "$PLATFORM/api/consultations/$CID/accept")
expect_match "$ACC" "ok.*true" "lucia accept ok"

# Client marks complete (FREE: no on-chain release tx required).
login_as 6 "$client_cookie"
COMP=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete")
echo "  complete response: $COMP"
ROW2=$(db_query "SELECT status, escrow_release_tx_hash FROM consultations WHERE id = $CID")
STATUS2=$(echo "$ROW2" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
RELEASE=$(echo "$ROW2" | python3 -c "import json,sys;r=json.load(sys.stdin)[0];print(r['escrow_release_tx_hash'] or 'null')")
expect_eq "$STATUS2" "COMPLETED" "free consultation completes without on-chain release"
expect_eq "$RELEASE" "null" "no release_tx for FREE"

echo "[S1] PASS"
