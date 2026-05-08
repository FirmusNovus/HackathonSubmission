#!/usr/bin/env bash
# Run every scenario in sequence. Stops on first failure.
set -euo pipefail
cd "$(dirname "$0")"

SCENARIOS=(
  s1-free-consultation
  s2-cancel-refund
  s3-decline-refund
  s4-escalate-cooldown
  s5-message-security
  s6-concurrent-mutations
  s7-role-gating
  s8-multi-proposal
  s8b-offer-forgery
  s9-input-validation
  s10-edge-cases
  s11-engagement-close
  s12-free-then-paid
  s13-stress-multi-engagement
  s14-unicode-messages
  s15-direct-chain-tampering
  s16-large-payloads
  s17-many-proposals
)

PASS=0
FAIL=0
START=$(date +%s)
for s in "${SCENARIOS[@]}"; do
  if bash "./$s.sh" > "/tmp/.scenario-$s.log" 2>&1; then
    echo "  ✓ $s"
    PASS=$((PASS+1))
  else
    echo "  ✗ $s"
    tail -10 "/tmp/.scenario-$s.log"
    FAIL=$((FAIL+1))
  fi
done
ELAPSED=$(($(date +%s) - START))

echo
echo "========================================"
echo "  $PASS / ${#SCENARIOS[@]} scenarios passed in ${ELAPSED}s"
echo "========================================"
[[ $FAIL -eq 0 ]]
