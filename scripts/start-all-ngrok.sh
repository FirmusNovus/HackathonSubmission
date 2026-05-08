#!/usr/bin/env bash
# Same as start-all.sh but also fronts the proxy with ngrok on PUBLIC_HOSTNAME.
# Owner spec: 001-verified-legal-engagement.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p .run-logs

if ! pgrep -f "ngrok http" > /dev/null 2>&1; then
  HOST=$(echo "$PUBLIC_HOSTNAME" | sed 's|https://||')
  echo "[start-all-ngrok] starting ngrok on $HOST -> 3000"
  nohup ngrok http --domain="$HOST" 3000 > .run-logs/ngrok.log 2>&1 &
  sleep 3
fi

bash scripts/start-all.sh
