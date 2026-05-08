#!/usr/bin/env bash
# Seeds the issuer DB with five pre-staged lawyer personas + one client.
# Owner spec: 001-verified-legal-engagement.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm -F @firmus-novus/issuer seed
echo "Issuer roster seeded."
