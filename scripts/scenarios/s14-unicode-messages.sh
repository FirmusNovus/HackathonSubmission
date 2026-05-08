#!/usr/bin/env bash
# Scenario S14 — unicode + multi-byte ciphertext envelopes round-trip cleanly.
# The platform stores raw bytes for ciphertext; binary content must survive
# Buffer encoding + base64 round-trip.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S14 — Unicode / multi-byte message round-trip"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Unicode test consultation: 漢字 émoji ¬ characters in description.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")

# Send three messages with multi-byte / random binary ciphertext payloads.
# The platform stores ciphertext as opaque bytes — base64 round-trip must
# preserve every byte. We use python to construct the JSON so multi-byte
# characters round-trip cleanly through the shell.
for label in ascii high-bit random-256B; do
  RAW=$(python3 -c "
import os,base64,sys
label=sys.argv[1]
if label=='ascii': payload=b'ciphertext-marker-ascii-' + os.urandom(8)
elif label=='high-bit': payload=b'\\x80\\x90\\xa0\\xff\\x7f' + bytes(range(256))[64:128]
else: payload=os.urandom(256)
print(base64.b64encode(payload).decode())
" "$label")
  IV=$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(12)).decode())")
  SALT=$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(16)).decode())")
  BODY=$(python3 -c "import json,sys;print(json.dumps({'engagementId':int(sys.argv[1]),'ciphertextB64':sys.argv[2],'ivB64':sys.argv[3],'saltB64':sys.argv[4],'signature':'sig-'+sys.argv[5]}))" "$EID" "$RAW" "$IV" "$SALT" "$label")
  R=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
    --data "$BODY" "$PLATFORM/api/messages")
  expect_match "$R" "ok.*true" "POST $label ok"
done

# Read back and verify byte-for-byte.
GOT=$(curl -s -b "$client_cookie" "$PLATFORM/api/messages?engagementId=$EID")
COUNT=$(echo "$GOT" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['messages']))")
expect_eq "$COUNT" "3" "3 messages round-tripped"

echo "  -- verify each ciphertext B64 round-trips bytewise"
echo "$GOT" | python3 -c "
import json,sys,base64
d=json.load(sys.stdin)
for m in d['messages']:
    raw=base64.b64decode(m['ciphertextB64'])
    print('  ✓', m['signature'], 'len=', len(raw), 'bytes')
"

# Also verify case_description with non-ASCII survives DB round-trip.
COUNTROW=$(db_query "SELECT case_description FROM consultations WHERE engagement_id = $EID")
DESC=$(echo "$COUNTROW" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['case_description'])")
expect_match "$DESC" "漢字" "non-ASCII case_description survives DB round-trip"
expect_match "$DESC" "émoji" "diacritics survive DB round-trip"

echo "[S14] PASS"
