#!/usr/bin/env bash
# Scenario S9 — input validation across mutating API routes.
# Every route should reject malformed input with 400 (zod) before it touches
# any chain state.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S9 — Input validation"
require_services
reset_platform

client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"

assert_status() {
  local label=$1 expected=$2 method=$3 url=$4 body=${5:-}
  local cookie=${6:-$client_cookie}
  local out=/tmp/.s9-resp
  local code
  if [[ -n "$body" ]]; then
    code=$(curl -s -o "$out" -X "$method" -H "Content-Type: application/json" -b "$cookie" --data "$body" "$url" -w "%{http_code}")
  else
    code=$(curl -s -o "$out" -X "$method" -b "$cookie" "$url" -w "%{http_code}")
  fi
  if [[ "$code" != "$expected" ]]; then
    echo "[FAIL] $label: expected HTTP $expected, got $code; body: $(cat $out | head -c 200)" >&2
    exit 1
  fi
  echo "  ✓ $label (HTTP $code)"
}

echo "  -- /api/consultations: bad inputs"
assert_status "missing fields" 400 POST "$PLATFORM/api/consultations" '{}'
assert_status "invalid lawyerAddress" 400 POST "$PLATFORM/api/consultations" '{"lawyerAddress":"not-an-address","scheduledAt":1,"durationMinutes":30,"practiceArea":"Family","caseDescription":"valid description for testing 1234"}'
assert_status "duration not 30/60" 400 POST "$PLATFORM/api/consultations" '{"lawyerAddress":"0x0000000000000000000000000000000000000000","scheduledAt":1,"durationMinutes":45,"practiceArea":"Family","caseDescription":"valid description for testing 1234"}'
assert_status "case_description too short" 400 POST "$PLATFORM/api/consultations" '{"lawyerAddress":"0x0000000000000000000000000000000000000000","scheduledAt":1,"durationMinutes":30,"practiceArea":"Family","caseDescription":"too short"}'

echo
echo "  -- unauthenticated calls"
empty_cookie=$(mktemp)
assert_status "unauth /api/consultations" 401 POST "$PLATFORM/api/consultations" '{"lawyerAddress":"0x0000000000000000000000000000000000000000","scheduledAt":1,"durationMinutes":30,"practiceArea":"Family","caseDescription":"valid description for testing 1234"}' "$empty_cookie"

echo
echo "  -- /api/proposals zod"
assert_status "no engagementId" 400 POST "$PLATFORM/api/proposals" '{}' "$anna_cookie"
assert_status "empty lineItems" 400 POST "$PLATFORM/api/proposals" '{"engagementId":1,"lineItems":[],"deliverables":[{"id":"d","title":"x"}]}' "$anna_cookie"
assert_status "client cannot issue" 401 POST "$PLATFORM/api/proposals" '{"engagementId":1,"lineItems":[{"id":"a","title":"t","kind":"fixed","fixedPrice":"1","subtotal":"1"}],"deliverables":[{"id":"d","title":"x"}]}' "$client_cookie"

echo
echo "  -- /api/messages zod"
assert_status "missing required fields" 400 POST "$PLATFORM/api/messages" '{"engagementId":1}'
assert_status "extra plaintext" 400 POST "$PLATFORM/api/messages" '{"engagementId":1,"plaintext":"x","ciphertextB64":"AAAA","ivB64":"AAAA","saltB64":"AAAA","signature":"x"}'

echo
echo "  -- /api/dev/login zod"
assert_status "persona out of range" 400 POST "$PLATFORM/api/dev/login" '{"persona":99}'
assert_status "missing persona" 400 POST "$PLATFORM/api/dev/login" '{}'

echo
echo "  -- /api/operator/disputes/.../resolve gating"
assert_status "non-operator cannot resolve" 401 POST "$PLATFORM/api/operator/disputes/1/0/resolve" '{"toLawyer":"0","toClient":"0"}' "$client_cookie"

echo "[S9] PASS"
