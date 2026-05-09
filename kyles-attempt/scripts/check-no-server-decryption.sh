#!/usr/bin/env bash
# F8 — Constitution invariant 1: server-side code MUST NOT import any browser
# crypto. Any import of `lib/crypto/*` (or `@/lib/crypto/*`) from a server-only
# tree is a build-time failure.
#
# Greps the four server surfaces:
#   - app/api/**         (route handlers)
#   - lib/auth/**        (auth-config + session helpers)
#   - lib/chain/**       (mock-chain + EIP-712 verification)
#   - middleware.ts      (edge-runtime middleware)
#
# Exits 1 with the offending lines on any match.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATTERN='from ["'\'']@/lib/crypto|from ["'\'']\.\./.*lib/crypto|from ["'\'']\.\.?/crypto|require\(["'\'']@/lib/crypto'

# `git ls-files`-driven walk so untracked node_modules stay out of scope.
TARGETS=()
for dir in app/api lib/auth lib/chain; do
  if [ -d "$dir" ]; then
    TARGETS+=("$dir")
  fi
done

if [ -f middleware.ts ]; then
  TARGETS+=("middleware.ts")
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "[check-no-server-decryption] no server trees found; nothing to check"
  exit 0
fi

# `grep -rE` returns 1 on no-match; we want that to be SUCCESS, so swallow it.
HITS="$(grep -rEn --include='*.ts' --include='*.tsx' "$PATTERN" "${TARGETS[@]}" || true)"

if [ -n "$HITS" ]; then
  echo "[check-no-server-decryption] ERROR — server-side imports of lib/crypto/* detected:"
  echo
  echo "$HITS"
  echo
  echo "lib/crypto/* is BROWSER-ONLY (Constitution invariant 1)."
  echo "The server must never decrypt. Move the import to a client-only file."
  exit 1
fi

echo "[check-no-server-decryption] OK — no server-side imports of lib/crypto/*"
exit 0
