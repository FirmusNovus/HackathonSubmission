#!/usr/bin/env bash
# scripts/start-ngrok.sh — same as start.sh, but exposes the stack via a
# public ngrok tunnel and feeds the resulting URL into the container as
# PUBLIC_HOSTNAME (so wallet-visible issuer + verifier URLs match what the
# EUDI wallet actually reaches).
#
# Requires:
#   • Docker (host)
#   • ngrok CLI on PATH, with `ngrok config add-authtoken …` already done.
#
# Usage:  bash scripts/start-ngrok.sh

set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=${IMAGE:-firmus-novus:jury}
NAME=${NAME:-firmus-novus}
PORT=${PORT:-3000}
OTS_NAME=${OTS_NAME:-firmus-otterscan}
OTS_PORT=${OTS_PORT:-5100}
OTS_IMAGE=${OTS_IMAGE:-otterscan/otterscan:latest}

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is not installed"
command -v ngrok  >/dev/null || die "ngrok CLI not installed. See https://ngrok.com/download"
command -v curl   >/dev/null || die "curl is required"

# ngrok's local API hosts on 4040 by default. Reuse a running tunnel if one
# is already up; otherwise spawn a fresh one in the background.
NGROK_API="http://127.0.0.1:4040/api/tunnels"

extract_url() {
  curl -fsS "$NGROK_API" 2>/dev/null \
    | jq -r '.tunnels[] | select(.public_url|startswith("https://")) | .public_url' \
    | head -n1
}

if curl -fsS "$NGROK_API" >/dev/null 2>&1 && [ -n "$(extract_url)" ]; then
  ok "ngrok already running on :4040"
else
  step "Starting ngrok tunnel for :${PORT}"
  # `nohup` so the tunnel survives this script exit; logs to /tmp.
  nohup ngrok http "${PORT}" --log=stdout > /tmp/firmus-ngrok.log 2>&1 &
  for i in $(seq 1 30); do
    if curl -fsS "$NGROK_API" >/dev/null 2>&1 && [ -n "$(extract_url)" ]; then
      ok "ngrok up"
      break
    fi
    sleep 0.5
    if [ "$i" = 30 ]; then
      cat /tmp/firmus-ngrok.log >&2
      die "ngrok did not publish a tunnel within 15s"
    fi
  done
fi

PUBLIC_URL=$(extract_url)
[ -n "$PUBLIC_URL" ] || die "could not determine ngrok public URL"
ok "public URL: ${PUBLIC_URL}"

step "Building Docker image (${IMAGE})"
docker build -t "$IMAGE" .
ok "image built"

step "Stopping any previous containers"
docker rm -f "$NAME" "$OTS_NAME" >/dev/null 2>&1 || true

step "Starting Firmus Novus on :${PORT} with PUBLIC_HOSTNAME=${PUBLIC_URL}"
# 8545 stays exposed locally for MetaMask. Anvil is NOT tunneled through ngrok —
# anyone testing the chain flows must run the container themselves.
docker run -d --name "$NAME" \
  -p "${PORT}:3000" \
  -p "8545:8545" \
  -e PUBLIC_HOSTNAME="$PUBLIC_URL" \
  "$IMAGE" >/dev/null
ok "container started"

step "Waiting for the stack to come up…"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT}" >/dev/null 2>&1; then
    ok "ready"
    break
  fi
  sleep 1
  if [ "$i" = 60 ]; then
    echo
    docker logs --tail 80 "$NAME" >&2 || true
    die "container did not respond within 60s — see logs above"
  fi
done

step "Starting Otterscan (block explorer) on :${OTS_PORT}"
# ERIGON_URL is read by the React app *in the browser*. For local viewing use
# localhost; for remote viewers via ngrok you'd need to also tunnel :8545
# and override OTS_ERIGON_URL with that public URL.
docker run -d --name "$OTS_NAME" \
  -p "${OTS_PORT}:80" \
  -e ERIGON_URL="${OTS_ERIGON_URL:-http://localhost:8545}" \
  "$OTS_IMAGE" >/dev/null
ok "otterscan started"

cat <<MSG

  Firmus Novus is live at  →  ${PUBLIC_URL}
  (also available locally at  →  http://localhost:${PORT})
  Block explorer (Otterscan)  →  http://localhost:${OTS_PORT}

  Logs:           docker logs -f ${NAME}
  ngrok logs:     tail -f /tmp/firmus-ngrok.log
  ngrok web UI:   http://127.0.0.1:4040
  Stop:           docker rm -f ${NAME} ${OTS_NAME}; pkill -f 'ngrok http'
  Reset:          bash scripts/reset.sh

MSG
