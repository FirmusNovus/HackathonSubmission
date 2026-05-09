#!/usr/bin/env bash
# Same as start-all.sh but also fronts the proxy with ngrok on PUBLIC_HOSTNAME.
# Owner spec: 001-verified-legal-engagement.
#
#   bash scripts/start-all-ngrok.sh              # honor DEV_BYPASS_EUDI from .env
#   bash scripts/start-all-ngrok.sh --bypass     # force DEV_BYPASS_EUDI=1
#   bash scripts/start-all-ngrok.sh --no-bypass  # force DEV_BYPASS_EUDI=0
#                                                # (full wwWallet flow; no persona picker)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p .run-logs

if ! pgrep -f "ngrok http" > /dev/null 2>&1; then
  echo "[start-all-ngrok] starting ngrok on $PUBLIC_HOSTNAME -> 3000"
  # ngrok 3.x: --url replaces --domain; full https URL accepted.
  nohup ngrok http --url="$PUBLIC_HOSTNAME" 3000 > .run-logs/ngrok.log 2>&1 &
  sleep 4
  if ! curl -s -o /dev/null --max-time 5 http://127.0.0.1:4040/api/tunnels; then
    echo "[start-all-ngrok] WARNING ngrok did not come up — see .run-logs/ngrok.log" >&2
  fi
fi

# Forward all flags to start-all.sh (--bypass / --no-bypass etc).
bash scripts/start-all.sh "$@"
