#!/usr/bin/env bash
# scripts/start.sh — bring up the full Firmus Novus stack inside Docker.
#
# Builds the image (if needed) and runs it on http://localhost:3000.
# The container bundles anvil + the three Next.js apps; nothing else is
# required on the host besides Docker.
#
# Usage:  bash scripts/start.sh

set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=${IMAGE:-firmus-novus:jury}
NAME=${NAME:-firmus-novus}
PORT=${PORT:-3000}
# Otterscan is a self-hosted, Etherscan-shaped block explorer. We run it as
# a sibling container pointed at the anvil RPC the main container exposes
# on :8545.
OTS_NAME=${OTS_NAME:-firmus-otterscan}
OTS_PORT=${OTS_PORT:-5100}
OTS_IMAGE=${OTS_IMAGE:-otterscan/otterscan:latest}

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is not installed. See https://docs.docker.com/get-docker/"

step "Building Docker image (${IMAGE})"
docker build -t "$IMAGE" .
ok "image built"

step "Stopping any previous containers"
docker rm -f "$NAME" "$OTS_NAME" >/dev/null 2>&1 || true
ok "clean slate"

step "Starting Firmus Novus on :${PORT}"
# 8545 is also exposed so MetaMask on the host can talk to the in-container
# anvil chain — the SIWE login + every "approve & fund" tx round-trips through it.
docker run -d --name "$NAME" \
  -p "${PORT}:3000" \
  -p "8545:8545" \
  -e PUBLIC_HOSTNAME="http://localhost:${PORT}" \
  "$IMAGE" >/dev/null
ok "container started"

step "Waiting for the proxy to come up…"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT}" >/dev/null 2>&1; then
    ok "ready"
    break
  fi
  sleep 1
  if [ "$i" = 60 ]; then
    echo
    docker logs --tail 80 "$NAME" >&2 || true
    die "container did not respond on :${PORT} within 60s — see logs above"
  fi
done

step "Starting Otterscan (block explorer) on :${OTS_PORT}"
# `--add-host` lets the otterscan container reach the host's :8545 (where
# anvil-in-firmus-novus is exposed). Required on Linux; harmless on macOS/Win.
docker run -d --name "$OTS_NAME" \
  --add-host=host.docker.internal:host-gateway \
  -p "${OTS_PORT}:80" \
  -e ERIGON_URL="http://host.docker.internal:8545" \
  "$OTS_IMAGE" >/dev/null
ok "otterscan started"

cat <<MSG

  Firmus Novus is live at  →  http://localhost:${PORT}
  Block explorer (Otterscan) →  http://localhost:${OTS_PORT}

  Logs:    docker logs -f ${NAME}
  Stop:    docker rm -f ${NAME} ${OTS_NAME}
  Reset:   bash scripts/reset.sh

MSG
