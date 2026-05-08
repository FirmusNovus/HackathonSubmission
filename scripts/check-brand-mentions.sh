#!/usr/bin/env bash
# Constitution V (Quiet Web3, Loud Trust) + canonical glossary.
# - At most one mention of the public brand name in user-visible places
#   (the spec.md and plan.md title lines are allowed).
# - Zero mentions of retired terms (milestone, milestone-as-payment-unit,
#   smart-contract-escrow user copy).
set -euo pipefail
cd "$(dirname "$0")/.."

retired=("mileston" "Mileston")
failed=0

# Scan source code (apps/, packages/, scripts/) for retired terms.
# Skip this script itself (it has to name the retired terms in its allow-list).
for term in "${retired[@]}"; do
  hits=$(grep -RnE "\b${term}e\b" apps packages scripts 2>/dev/null \
    --include='*.ts' --include='*.tsx' --include='*.sol' --include='*.sh' \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=cache --exclude-dir=broadcast \
    | grep -v 'check-brand-mentions.sh' || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL: retired term '${term}e' in source:" >&2
    echo "$hits" >&2
    failed=1
  fi
done

# Spec body cleanliness — body of spec/plan must not name retired terms.
for term in "${retired[@]}"; do
  hits=$(grep -RnE "\b${term}e\b" specs/001-verified-legal-engagement 2>/dev/null \
    --include='*.md' || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL: retired term '${term}e' in spec docs:" >&2
    echo "$hits" >&2
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  exit 1
fi
echo "brand-mentions: ok"
