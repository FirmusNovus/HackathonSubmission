#!/usr/bin/env bash
# Scenario S19 — operator revokes a lawyer's capability mid-engagement.
# Constraints expected:
#  - Existing engagement / proposals continue to settle on chain (escrow
#    funds remain accessible to release/dispute paths).
#  - Lawyer can no longer be selected for a NEW engagement (NotVerifiedLawyer).
#  - The lawyer disappears from the public directory.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

banner "S19 — Operator revokes lawyer capability mid-flow"
require_services
reset_platform

ANNA=$(lawyer_addr anna-schmidt)
client_cookie=$(mktemp); login_as 6 "$client_cookie"
anna_cookie=$(mktemp); login_as 1 "$anna_cookie"

# Open + accept a paid engagement before revocation.
RES=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 09:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Engagement opened just before Anna's capability gets revoked.\"}" \
  "$PLATFORM/api/consultations")
EID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['engagementId'])")
CID=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['consultationId'])")
curl -s -X POST -b "$anna_cookie" "$PLATFORM/api/consultations/$CID/accept" > /dev/null

# Verify Anna is in the directory.
DIR_BEFORE=$(curl -s "$PLATFORM/api/lawyers" | python3 -c "import json,sys;print(any(l['slug']=='anna-schmidt' for l in json.load(sys.stdin)['lawyers']))")
expect_eq "$DIR_BEFORE" "True" "Anna in public directory before revocation"

# Operator revokes Anna's lawyer capability.
echo "  -- operator revokes Anna's lawyer attestation"
set -a; source "$ROOT/.env"; set +a
SCHEMA_LAWYER_HEX=$(grep "lawyer:" "$ROOT/apps/platform/lib/chain/addresses.ts" | sed -E "s/.*'(.*)'.*/\1/")
cast send "$AM" "revokeCapability(address,bytes32)" "$ANNA" "$SCHEMA_LAWYER_HEX" \
  --rpc-url "$RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY" > /dev/null

# Trigger an indexer pass so the platform sees the Revoked event and updates verified_users.
# Our current indexer doesn't watch AttestationManager events; revocations are reflected
# purely through hasCapability. Verify by direct chain call:
HAS=$(cast call "$AM" "hasCapability(address,bytes32)(bool)" "$ANNA" "$SCHEMA_LAWYER_HEX" --rpc-url "$RPC_URL")
expect_eq "$HAS" "false" "hasCapability(Anna, lawyer) = false post-revoke"

# A new client request must fail at the contract: NotVerifiedLawyer.
echo
echo "  -- new engagement attempt against Anna must revert"
RES2=$(curl -s -X POST -H "Content-Type: application/json" -b "$client_cookie" \
  --data "{\"lawyerAddress\":\"$ANNA\",\"scheduledAt\":$(date -d 'tomorrow 11:00' +%s),\"durationMinutes\":30,\"practiceArea\":\"Family\",\"caseDescription\":\"Should fail because Anna's capability was just revoked.\"}" \
  "$PLATFORM/api/consultations")
echo "    response: $RES2"
expect_match "$RES2" "not-verified-lawyer|broadcast-failed" "new engagement reverts NotVerifiedLawyer"

# Existing engagement: client can still mark complete (releaseProposal does
# NOT re-check the lawyer's attestation — only the escrow state machine).
echo
echo "  -- existing engagement still completes on chain"
COMP=$(curl -s -X POST -b "$client_cookie" "$PLATFORM/api/consultations/$CID/complete")
expect_match "$COMP" "ok.*true" "client can still releaseProposal post-revocation"

PROP=$(proposal_chain_state "$EID" 0)
expect_eq "$(echo "$PROP" | awk -F, '{print $2}')" "3" "proposal state=Released"

# After the syncFromChain triggered by the release call, the directory
# should drop Anna (the indexer mirrors AM.Revoked → verified_users.revoked_at).
DIR_AFTER=$(curl -s "$PLATFORM/api/lawyers" | python3 -c "import json,sys;print(any(l['slug']=='anna-schmidt' for l in json.load(sys.stdin)['lawyers']))")
expect_eq "$DIR_AFTER" "False" "Anna no longer in directory after revocation+sync"

# Re-attest so subsequent scenarios still work.
echo
echo "  -- re-attesting Anna for downstream scenarios"
cast send "$AM" "attestVerifiedLawyer(address,string,string,uint64,uint64)" \
  "$ANNA" "DE" "RAK-Muenchen-2018-04321" 1523491200 1903133200 \
  --rpc-url "$RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY" > /dev/null

# Trigger a sync so the indexer sees the new Attested event and clears
# revoked_at. The next mutating API call re-flushes; for the assertion we
# rely on the run-all chain so tests after this one will see Anna restored.

echo "[S19] PASS"
