#!/usr/bin/env bash
# Scenario S5 — message API security.
# Constitution Inv 1: server NEVER sees plaintext.
# - POST with `plaintext` field returns 400.
# - POST from a non-participant returns 403.
# - GET from a non-participant returns 403.
# - Valid POST + GET round-trips ciphertext envelopes.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S5 — Message API security"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 13:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Setup an engagement so we can test messaging security.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")

echo "  -- POST with plaintext field MUST be rejected"
PLAIN=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"engagementId\":$EID,\"plaintext\":\"hello\",\"ciphertextB64\":\"AAAA\",\"ivB64\":\"AAAA\",\"saltB64\":\"AAAA\",\"signature\":\"x\"}" \
  -o /tmp/.s5-plain "$PLATFORM/api/messages" -w "%{http_code}")
echo "    HTTP $PLAIN: $(cat /tmp/.s5-plain)"
expect_eq "$PLAIN" "400" "plaintext field rejected with 400"
expect_match "$(cat /tmp/.s5-plain)" "plaintext-not-allowed" "error code 'plaintext-not-allowed'"

echo
echo "  -- POST from non-participant (Sofia, persona 4) MUST be rejected"
sofia_cookie=$(mktemp); login_as 4 "$sofia_cookie"
NP=$(curl -s -X POST -H "Content-Type: application/json" -b "$sofia_cookie" \
  --data "{\"engagementId\":$EID,\"ciphertextB64\":\"$(echo -n hello | base64)\",\"ivB64\":\"$(echo -n 0123456789ab | base64)\",\"saltB64\":\"$(echo -n 0123456789abcdef | base64)\",\"signature\":\"sig\"}" \
  -o /tmp/.s5-np "$PLATFORM/api/messages" -w "%{http_code}")
echo "    HTTP $NP: $(cat /tmp/.s5-np)"
expect_eq "$NP" "403" "non-participant POST rejected with 403"

echo
echo "  -- GET from non-participant MUST be rejected"
NP_GET=$(curl -s -b "$sofia_cookie" -o /tmp/.s5-npg "$PLATFORM/api/messages?engagementId=$EID" -w "%{http_code}")
echo "    HTTP $NP_GET: $(cat /tmp/.s5-npg)"
expect_eq "$NP_GET" "403" "non-participant GET rejected with 403"

echo
echo "  -- valid participant POST roundtrips a ciphertext envelope"
CT=$(echo -n "ciphertext-bytes" | base64)
IV=$(echo -n "iv-12-bytes!" | base64)
SALT=$(echo -n "salt-16-bytes!!!" | base64)
OK=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"engagementId\":$EID,\"ciphertextB64\":\"$CT\",\"ivB64\":\"$IV\",\"saltB64\":\"$SALT\",\"signature\":\"sig\"}" \
  "$PLATFORM/api/messages")
echo "    POST: $OK"
expect_match "$OK" "ok.*true" "valid participant POST ok"

GET_RES=$(curl -s -b "$client_cookie" "$PLATFORM/api/messages?engagementId=$EID")
COUNT=$(echo "$GET_RES" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['messages']))")
expect_eq "$COUNT" "1" "1 message read back"
ECHO_CT=$(echo "$GET_RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['messages'][0]['ciphertextB64'])")
expect_eq "$ECHO_CT" "$CT" "ciphertext B64 round-trips"

echo
echo "  -- DB column check: ensure no plaintext column exists"
COLS=$(db_query "PRAGMA table_info(messages)")
HAS_PLAINTEXT=$(echo "$COLS" | python3 -c "import json,sys;print(any(c['name']=='plaintext' for c in json.load(sys.stdin)))")
expect_eq "$HAS_PLAINTEXT" "False" "no 'plaintext' column on messages"

echo "[S5] PASS"
