#!/usr/bin/env bash
# Single-tunnel launcher: issuer + verifier are local services behind a
# path-routing proxy. ngrok exposes only the proxy. URLs:
#   https://<ngrok>/issuer/*   → issuer
#   https://<ngrok>/verifier/* → verifier
cd "$(dirname "$0")"

NGROK_CONFIG=/tmp/lex-ngrok.yml
NGROK_LOG=/tmp/lex-ngrok.log
ISSUER_LOG=/tmp/lex-issuer.log
VERIFIER_LOG=/tmp/lex-verifier.log
PROXY_LOG=/tmp/lex-proxy.log

cleanup() {
  echo ""
  echo "[stopping]"
  pkill -P $$ >/dev/null 2>&1
  pkill -f "node issuer.mjs" >/dev/null 2>&1
  pkill -f "node verifier.mjs" >/dev/null 2>&1
  pkill -f "node proxy.mjs" >/dev/null 2>&1
  pkill -f "ngrok start" >/dev/null 2>&1
  pkill -f "ngrok http" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

echo "[0] Killing leftover processes..."
pkill -9 -f "node issuer.mjs" >/dev/null 2>&1
pkill -9 -f "node verifier.mjs" >/dev/null 2>&1
pkill -9 -f "node proxy.mjs" >/dev/null 2>&1
pkill -9 -f "ngrok start" >/dev/null 2>&1
pkill -9 -f "ngrok http" >/dev/null 2>&1
sleep 1

if ! command -v ngrok >/dev/null 2>&1; then
  echo "  ✗ ngrok not found"
  exit 1
fi

# ---- Step 1: start local servers (issuer:3001, verifier:3002) ----
echo ""
echo "[1] Starting issuer (3001) + verifier (3002) + proxy (3000) locally..."
: > "$ISSUER_LOG"
: > "$VERIFIER_LOG"
: > "$PROXY_LOG"

# Provisional URLs; will be replaced after ngrok comes up
ISSUER_URL="http://localhost:3001" node issuer.mjs > "$ISSUER_LOG" 2>&1 &
ISSUER_PID=$!
VERIFIER_URL="http://localhost:3002" node verifier.mjs > "$VERIFIER_LOG" 2>&1 &
VERIFIER_PID=$!
PORT=3000 node proxy.mjs > "$PROXY_LOG" 2>&1 &
PROXY_PID=$!

ISSUER_OK=0; VERIFIER_OK=0; PROXY_OK=0
for i in $(seq 1 16); do
  sleep 0.5
  for p in $ISSUER_PID $VERIFIER_PID $PROXY_PID; do
    if ! kill -0 $p 2>/dev/null; then
      echo "  ✗ a server crashed. Logs:"
      echo "  --- issuer ---"; tail -10 "$ISSUER_LOG" | sed 's/^/    /'
      echo "  --- verifier ---"; tail -10 "$VERIFIER_LOG" | sed 's/^/    /'
      echo "  --- proxy ---"; tail -10 "$PROXY_LOG" | sed 's/^/    /'
      exit 1
    fi
  done
  if [ "$ISSUER_OK" = 0 ] && grep -q "listening on" "$ISSUER_LOG"; then ISSUER_OK=1; fi
  if [ "$VERIFIER_OK" = 0 ] && grep -q "listening on" "$VERIFIER_LOG"; then VERIFIER_OK=1; fi
  if [ "$PROXY_OK" = 0 ] && grep -q "listening on" "$PROXY_LOG"; then PROXY_OK=1; fi
  [ "$ISSUER_OK$VERIFIER_OK$PROXY_OK" = "111" ] && break
done
[ "$ISSUER_OK" = 1 ]   || { echo "  ✗ issuer didn't listen"; exit 1; }
[ "$VERIFIER_OK" = 1 ] || { echo "  ✗ verifier didn't listen"; exit 1; }
[ "$PROXY_OK" = 1 ]    || { echo "  ✗ proxy didn't listen"; exit 1; }
echo "  ✓ issuer (3001), verifier (3002), proxy (3000) listening"
echo "  ✓ proxy: GET localhost:3000/issuer/.well-known/openid-credential-issuer -> $(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/issuer/.well-known/openid-credential-issuer)"
echo "  ✓ proxy: GET localhost:3000/verifier/                                    -> $(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/verifier/)"

# ---- Step 2: start one ngrok tunnel for the proxy ----
echo ""
echo "[2] Starting one ngrok tunnel for the proxy on port 3000..."
: > "$NGROK_LOG"
ngrok http 3000 --log=stdout > "$NGROK_LOG" 2>&1 &
NGROK_PID=$!

echo "    waiting up to 20s for tunnel to register..."
NGROK_URL=""
for i in $(seq 1 40); do
  sleep 0.5
  if ! kill -0 $NGROK_PID 2>/dev/null; then
    echo "  ✗ ngrok died. Log:"
    sed 's/^/      /' "$NGROK_LOG"
    exit 1
  fi
  TUNNELS_JSON=$(curl -s --max-time 1 http://127.0.0.1:4040/api/tunnels 2>/dev/null)
  if [ -n "$TUNNELS_JSON" ] && echo "$TUNNELS_JSON" | grep -q '"public_url"'; then
    NGROK_URL=$(echo "$TUNNELS_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for t in d.get('tunnels', []):
        url = t.get('public_url', '')
        if url.startswith('https://'):
            print(url); break
except: pass
" 2>/dev/null)
    [ -n "$NGROK_URL" ] && break
  fi
done
[ -n "$NGROK_URL" ] || { echo "  ✗ couldn't extract ngrok URL"; exit 1; }
echo "  ✓ tunnel: $NGROK_URL"

ISSUER_PUBLIC="$NGROK_URL/issuer"
VERIFIER_PUBLIC="$NGROK_URL/verifier"

# ---- Step 3: restart issuer + verifier with public-prefixed URLs ----
echo ""
echo "[3] Restarting issuer + verifier with public URLs:"
echo "    issuer:   $ISSUER_PUBLIC"
echo "    verifier: $VERIFIER_PUBLIC"
kill $ISSUER_PID $VERIFIER_PID 2>/dev/null
wait $ISSUER_PID 2>/dev/null
wait $VERIFIER_PID 2>/dev/null
sleep 1
: > "$ISSUER_LOG"
: > "$VERIFIER_LOG"
ISSUER_URL="$ISSUER_PUBLIC" node issuer.mjs > "$ISSUER_LOG" 2>&1 &
ISSUER_PID=$!
VERIFIER_URL="$VERIFIER_PUBLIC" node verifier.mjs > "$VERIFIER_LOG" 2>&1 &
VERIFIER_PID=$!

ISSUER_OK=0; VERIFIER_OK=0
for i in $(seq 1 16); do
  sleep 0.5
  if ! kill -0 $ISSUER_PID 2>/dev/null; then echo "  ✗ issuer crashed"; tail -20 "$ISSUER_LOG"; exit 1; fi
  if ! kill -0 $VERIFIER_PID 2>/dev/null; then echo "  ✗ verifier crashed"; tail -20 "$VERIFIER_LOG"; exit 1; fi
  if [ "$ISSUER_OK" = 0 ] && grep -q "listening on" "$ISSUER_LOG"; then ISSUER_OK=1; fi
  if [ "$VERIFIER_OK" = 0 ] && grep -q "listening on" "$VERIFIER_LOG"; then VERIFIER_OK=1; fi
  [ "$ISSUER_OK$VERIFIER_OK" = "11" ] && break
done
[ "$ISSUER_OK" = 1 ]   || { echo "  ✗ issuer didn't restart"; exit 1; }
[ "$VERIFIER_OK" = 1 ] || { echo "  ✗ verifier didn't restart"; exit 1; }
echo "  ✓ both servers running with public URLs"

# ---- Step 4: end-to-end check via ngrok ----
echo ""
echo "[4] End-to-end reachability via ngrok..."
fetch_with_retries() {
  local url="$1"; local label="$2"
  for i in $(seq 1 8); do
    local code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 4 "$url" 2>/dev/null)
    if [ "$code" = "200" ]; then echo "  ✓ $label -> 200"; return 0; fi
    sleep 1
  done
  echo "  ⚠ $label -> not reachable from this shell (may still work from your browser)"
}
fetch_with_retries "$ISSUER_PUBLIC/.well-known/openid-credential-issuer" "issuer metadata"
fetch_with_retries "$VERIFIER_PUBLIC/"                                   "verifier UI"

cat <<EOF

==========================================================================
READY (single ngrok tunnel, path-routed)

Open in browser:
  Issuer UI:    $ISSUER_PUBLIC
  Verifier UI:  $VERIFIER_PUBLIC
  Landing:      $NGROK_URL
  wwWallet:     https://demo.wwwallet.org

Live ngrok inspector:  http://127.0.0.1:4040

Press Ctrl-C to stop.
==========================================================================
EOF

tail -F "$ISSUER_LOG" "$VERIFIER_LOG" "$PROXY_LOG" 2>/dev/null &

wait $ISSUER_PID $VERIFIER_PID
