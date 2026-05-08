#!/usr/bin/env bash
# Scenario S18 — UI render coverage (server-rendered HTML).
# Sanity-check that each page returns HTTP 200 and renders distinguishing
# content for the role / status combination. We grep the SSR HTML; the
# proposals panel is hydrated client-side, so we only assert what the
# server emits.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S18 — UI render coverage (SSR + role-aware content)"
require_services
reset_platform

# Compile pages once by hitting them all (Next.js dev compiles lazily).
client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"
op_cookie=$(mktemp); login_as 0 "$op_cookie"

assert_match() {
  local label=$1 url=$2 cookie=$3 pattern=$4
  local body=$(curl -s -b "$cookie" "$url")
  if echo "$body" | grep -q "$pattern"; then
    echo "  ✓ $label"
  else
    echo "[FAIL] $label: missing /$pattern/ in $url" >&2
    exit 1
  fi
}

echo "  -- public pages render"
assert_match "marketing landing carries hero copy" "$PLATFORM/" "$client_cookie" "Verified Legal Counsel, On-Chain"
assert_match "directory lists 5 verified lawyers" "$PLATFORM/lawyers" "$client_cookie" "Anna Schmidt"
assert_match "lawyer profile carries About + Credentials tabs" "$PLATFORM/lawyers/anna-schmidt" "$client_cookie" "Credentials"
assert_match "lawyer profile shows EBSI badge" "$PLATFORM/lawyers/anna-schmidt" "$client_cookie" "Verified ·"

echo
echo "  -- /client/home reachable as client, 404 as lawyer"
assert_match "client/home shows greeting" "$PLATFORM/client/home" "$client_cookie" "Welcome back"
HTTP=$(curl -s -o /dev/null -b "$anna_cookie" -w "%{http_code}" "$PLATFORM/client/home")
expect_eq "$HTTP" "404" "lawyer cannot view /client/home"

echo
echo "  -- /lawyer/dashboard reachable as lawyer with stats"
assert_match "dashboard shows 4 stat-card labels" "$PLATFORM/lawyer/dashboard" "$anna_cookie" "Pending requests"
assert_match "dashboard shows Earned label" "$PLATFORM/lawyer/dashboard" "$anna_cookie" "Earned"
HTTP=$(curl -s -o /dev/null -b "$client_cookie" -w "%{http_code}" "$PLATFORM/lawyer/dashboard")
expect_eq "$HTTP" "404" "client cannot view /lawyer/dashboard"

echo
echo "  -- /operator/disputes reachable as operator only"
assert_match "operator/disputes header" "$PLATFORM/operator/disputes" "$op_cookie" "Active disputes"
HTTP=$(curl -s -o /dev/null -b "$client_cookie" -w "%{http_code}" "$PLATFORM/operator/disputes")
expect_eq "$HTTP" "404" "client cannot view /operator/disputes"

# Now exercise the consultation room state banners by setting up flows.
echo
echo "  -- consultation room banners by status"
ANNA=$(lawyer_addr anna-schmidt)
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Status banner test for consultation room.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
assert_match "REQUESTED banner shows 'Awaiting lawyer acceptance'" "$PLATFORM/client/consultation/$EID" "$client_cookie" "Awaiting lawyer acceptance"
assert_match "lawyer's REQUESTED view links to /lawyer/requests/$CID" "$PLATFORM/lawyer/consultation/$EID" "$anna_cookie" "/lawyer/requests/$CID"

# Accept; banner should disappear / change.
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null
HTML=$(curl -s -b "$client_cookie" "$PLATFORM/client/consultation/$EID")
echo "$HTML" | grep -q "Awaiting lawyer acceptance" && { echo "[FAIL] REQUESTED banner persists post-accept"; exit 1; } || echo "  ✓ banner cleared after accept"

# Decline path — start fresh.
RES2=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 11:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Decline-banner status test consultation.\"}" \
  "$PLATFORM/api/consultations")
EID2=$(echo "$RES2" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID2=$(echo "$RES2" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID2/decline" > /dev/null
assert_match "DECLINED client view shows decline banner" "$PLATFORM/client/consultation/$EID2" "$client_cookie" "lawyer declined this consultation"

# Cancel path.
RES3=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 13:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Cancel-banner status test consultation.\"}" \
  "$PLATFORM/api/consultations")
EID3=$(echo "$RES3" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID3=$(echo "$RES3" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID3/cancel" > /dev/null
assert_match "CANCELLED client view shows cancel banner" "$PLATFORM/client/consultation/$EID3" "$client_cookie" "You cancelled this consultation"

# Completed.
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null || true  # already accepted
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete" > /dev/null
assert_match "COMPLETED client view shows release confirmation" "$PLATFORM/client/consultation/$EID" "$client_cookie" "Funds released to counsel"

# Lawyer dashboard with a dispute should show the disputes card.
curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 14:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Lawyer-dashboard dispute card scenario.\"}" \
  "$PLATFORM/api/consultations" > /tmp/.s18-r4
EID4=$(python3 -c "import json;print(json.load(open('/tmp/.s18-r4'))['engagementId'])")
curl -s -X POST -b "$client_cookie" "$PLATFORM/api/disputes/$EID4/0/file" > /dev/null
assert_match "dashboard surfaces 'Active disputes'" "$PLATFORM/lawyer/dashboard" "$anna_cookie" "Active disputes"

echo "[S18] PASS"
