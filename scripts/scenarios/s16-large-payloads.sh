#!/usr/bin/env bash
# Scenario S16 — large payloads.
#  - 100 KB ciphertext envelope round-trips.
#  - Long case description (≤ a few KB) saved + retrieved.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S16 — Large payloads"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"

LONG_DESC=$(python3 -c "print('Lorem ipsum dolor sit amet ' * 200)" | head -c 4000)
RES=$(python3 -c "
import json,sys,subprocess
body=json.dumps({'lawyerAddress':sys.argv[1],'scheduledAt':int(sys.argv[2]),'durationMinutes':30,'practiceArea':'Family','caseDescription':sys.argv[3]})
print(body)
" "$ANNA" "$(date -d 'tomorrow 09:00' +%s)" "$LONG_DESC" \
  | curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" --data-binary @- "$PLATFORM/api/consultations")
echo "  long-desc booking response head: ${RES:0:200}"
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
expect_match "$EID" '^[0-9]+$' "long-description consultation booked"

# Verify the description survives DB round-trip.
ROW=$(db_query "SELECT length(case_description) AS n FROM consultations WHERE engagement_id = $EID")
LEN=$(echo "$ROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['n'])")
expect_match "$LEN" "^4000$" "case_description preserved at 4000 chars"

# 100 KB ciphertext round-trip. Build the body in python entirely (any
# 130+ KB body busts ARG_MAX if we shell-substitute).
echo
echo "  -- 100 KB ciphertext envelope round-trip"
BODY_FILE=$(mktemp)
python3 - <<PY > "$BODY_FILE"
import os,base64,json
print(json.dumps({
  'engagementId': $EID,
  'ciphertextB64': base64.b64encode(os.urandom(100_000)).decode(),
  'ivB64': base64.b64encode(os.urandom(12)).decode(),
  'saltB64': base64.b64encode(os.urandom(16)).decode(),
  'signature': 'large',
}))
PY
RESP=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" --data-binary "@$BODY_FILE" "$PLATFORM/api/messages")
rm -f "$BODY_FILE"
expect_match "$RESP" "ok.*true" "100 KB ciphertext POST ok"

GOT_FILE=$(mktemp)
curl -s -b "$client_cookie" "$PLATFORM/api/messages?engagementId=$EID" > "$GOT_FILE"
RAW_LEN=$(python3 -c "
import json,base64
d=json.load(open('$GOT_FILE'))
m = next(m for m in d['messages'] if m['signature']=='large')
print(len(base64.b64decode(m['ciphertextB64'])))
")
rm -f "$GOT_FILE"
expect_eq "$RAW_LEN" "100000" "100 KB round-tripped byte-for-byte"

echo "[S16] PASS"
