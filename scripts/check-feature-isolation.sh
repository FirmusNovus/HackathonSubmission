#!/usr/bin/env bash
# Forbids cross-feature imports between sibling modules under
# apps/platform/app/(client|lawyer|operator)/ and
# apps/platform/components/firmus/. Constitution Inv 7 / Inv 9.
set -euo pipefail
cd "$(dirname "$0")/.."

failed=0
patterns=(
  "from\s+['\"](\.\./)*\(?(client|lawyer|operator)\)?\/"
)

if [[ -d apps/platform/app ]]; then
  for feature in client lawyer operator; do
    base="apps/platform/app/($feature)"
    [[ -d "$base" ]] || continue
    while IFS= read -r f; do
      # Disallow imports to sibling features.
      for sib in client lawyer operator; do
        [[ "$sib" == "$feature" ]] && continue
        if grep -nE "from\s+['\"][^'\"]*\(${sib}\)\/" "$f" > /dev/null 2>&1; then
          echo "FAIL: $f imports from sibling feature ($sib)" >&2
          failed=1
        fi
      done
    done < <(find "$base" -type f \( -name '*.ts' -o -name '*.tsx' \))
  done
fi

if [[ $failed -ne 0 ]]; then
  exit 1
fi
echo "feature-isolation: ok"
