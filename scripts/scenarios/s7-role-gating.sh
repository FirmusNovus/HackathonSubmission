#!/usr/bin/env bash
# Scenario S7 — role gating + 404-on-mismatch (NOT 403, to avoid leaking
# path existence). Cross-engagement access blocked. Wrong-role API calls
# rejected at the route layer.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S7 — Role gating + 404-on-mismatch"
require_services
reset_platform

# Persona 6 = client; persona 1 (Anna) = lawyer; operator = anvil[0].
client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"

echo "  -- client visiting /lawyer/dashboard sees 404 (not 403) --"
HTTP=$(curl -s -o /dev/null -b "$client_cookie" -w "%{http_code}" "$PLATFORM/lawyer/dashboard")
expect_eq "$HTTP" "404" "client GET /lawyer/dashboard => 404"

echo "  -- lawyer visiting /client/home sees 404 --"
HTTP=$(curl -s -o /dev/null -b "$anna_cookie" -w "%{http_code}" "$PLATFORM/client/home")
expect_eq "$HTTP" "404" "lawyer GET /client/home => 404"

echo "  -- non-operator visiting /operator/disputes sees 404 --"
HTTP=$(curl -s -o /dev/null -b "$client_cookie" -w "%{http_code}" "$PLATFORM/operator/disputes")
expect_eq "$HTTP" "404" "client GET /operator/disputes => 404"
HTTP=$(curl -s -o /dev/null -b "$anna_cookie" -w "%{http_code}" "$PLATFORM/operator/disputes")
expect_eq "$HTTP" "404" "lawyer GET /operator/disputes => 404"

echo
echo "  -- /api/consultations/X/accept (lawyer-only) rejects clients --"
ANNA=$(lawyer_addr anna-schmidt)
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Test cross-role API access. 20+ chars satisfied.\"}" \
  "$PLATFORM/api/consultations")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")

# Client tries the lawyer-only accept route.
HTTP=$(curl -s -o /tmp/.s7-acc -b "$client_cookie" -X POST "$PLATFORM/api/consultations/$CID/accept" -w "%{http_code}")
echo "    client POST /api/consultations/$CID/accept -> HTTP $HTTP: $(cat /tmp/.s7-acc)"
expect_eq "$HTTP" "401" "client cannot accept (lawyer-only)"

echo "  -- /api/consultations/X/complete (client-only) rejects lawyers --"
HTTP=$(curl -s -o /tmp/.s7-comp -b "$anna_cookie" -X POST "$PLATFORM/api/consultations/$CID/complete" -w "%{http_code}")
echo "    lawyer POST /api/consultations/$CID/complete -> HTTP $HTTP: $(cat /tmp/.s7-comp)"
expect_eq "$HTTP" "401" "lawyer cannot complete (client-only)"

echo
echo "  -- a different lawyer cannot accept someone else's consultation --"
carlos_cookie=$(mktemp); login_as 2 "$carlos_cookie"
HTTP=$(curl -s -o /tmp/.s7-other -b "$carlos_cookie" -X POST "$PLATFORM/api/consultations/$CID/accept" -w "%{http_code}")
echo "    Carlos POST $CID/accept -> HTTP $HTTP: $(cat /tmp/.s7-other)"
# 404 — never leak path existence on cross-lawyer access.
expect_eq "$HTTP" "404" "wrong lawyer => 404 not 403"

echo
echo "  -- non-operator cannot resolve disputes --"
HTTP=$(curl -s -o /tmp/.s7-resv -b "$client_cookie" -X POST -H "Content-Type: application/json" \
  --data '{"toLawyer":"0","toClient":"0"}' \
  "$PLATFORM/api/operator/disputes/1/0/resolve" -w "%{http_code}")
echo "    client POST operator/disputes/1/0/resolve -> HTTP $HTTP: $(cat /tmp/.s7-resv)"
expect_eq "$HTTP" "401" "non-operator cannot resolve (401)"

echo
echo "  -- non-participant cannot read messages or post messages (already covered by S5)"

echo "[S7] PASS"
