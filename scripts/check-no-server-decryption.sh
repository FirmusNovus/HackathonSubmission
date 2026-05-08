#!/usr/bin/env bash
# Constitution Inv 1: the platform server has no decryption capability.
# Greps apps/platform/lib (excluding crypto/client and dev) for AES-GCM /
# ECDH derive imports.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d apps/platform/lib ]]; then
  echo "no-server-decryption: skipped (no platform/lib)"
  exit 0
fi

failed=0
while IFS= read -r f; do
  if grep -nE "(deriveSharedSecret|decryptMessage|deriveAesKey|deriveBits|AES-GCM)" "$f" > /dev/null 2>&1; then
    echo "FAIL: $f references decryption helper outside lib/crypto/client/" >&2
    failed=1
  fi
done < <(find apps/platform/lib -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path 'apps/platform/lib/crypto/client/*' \
  -not -path 'apps/platform/lib/dev/*')

if [[ $failed -ne 0 ]]; then
  exit 1
fi
echo "no-server-decryption: ok"
