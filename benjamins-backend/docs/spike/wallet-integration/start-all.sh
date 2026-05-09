#!/usr/bin/env bash
# Boots tunnels + servers and surfaces every failure mode loudly.
# Ctrl-C cleans up.
cd "$(dirname "$0")"

ISSUER_TUNNEL_LOG=/tmp/lex-issuer-tunnel.log
VERIFIER_TUNNEL_LOG=/tmp/lex-verifier-tunnel.log
ISSUER_LOG=/tmp/lex-issuer.log
VERIFIER_LOG=/tmp/lex-verifier.log

cleanup() {
  echo ""
  echo "[stopping]"
  pkill -P $$ >/dev/null 2>&1
  pkill -f "node issuer.mjs" >/dev/null 2>&1
  pkill -f "node verifier.mjs" >/dev/null 2>&1
  pkill -f "cloudflared tunnel" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

echo "[0] Killing leftover processes from prior runs..."
pkill -9 -f "node issuer.mjs" >/dev/null 2>&1
pkill -9 -f "node verifier.mjs" >/dev/null 2>&1
pkill -9 -f "cloudflared tunnel" >/dev/null 2>&1
sleep 1

# ---- Step 1: start the local node servers FIRST and verify they boot cleanly ----

echo ""
echo "[1] Starting issuer (port 3001) and verifier (port 3002) locally..."
: > "$ISSUER_LOG"
: > "$VERIFIER_LOG"

ISSUER_URL="http://localhost:3001" node issuer.mjs > "$ISSUER_LOG" 2>&1 &
ISSUER_PID=$!
VERIFIER_URL="http://localhost:3002" node verifier.mjs > "$VERIFIER_LOG" 2>&1 &
VERIFIER_PID=$!

# Wait for both to either start listening or crash
echo "    waiting up to 8s for boot..."
ISSUER_OK=0
VERIFIER_OK=0
for i in $(seq 1 16); do
  sleep 0.5
  if ! kill -0 $ISSUER_PID 2>/dev/null; then
    echo ""
    echo "  ✗ ISSUER CRASHED. Last log lines:"
    sed 's/^/      /' "$ISSUER_LOG"
    exit 1
  fi
  if ! kill -0 $VERIFIER_PID 2>/dev/null; then
    echo ""
    echo "  ✗ VERIFIER CRASHED. Last log lines:"
    sed 's/^/      /' "$VERIFIER_LOG"
    exit 1
  fi
  if [ "$ISSUER_OK" = 0 ] && grep -q "listening on" "$ISSUER_LOG" 2>/dev/null; then ISSUER_OK=1; fi
  if [ "$VERIFIER_OK" = 0 ] && grep -q "listening on" "$VERIFIER_LOG" 2>/dev/null; then VERIFIER_OK=1; fi
  if [ "$ISSUER_OK" = 1 ] && [ "$VERIFIER_OK" = 1 ]; then break; fi
done

if [ "$ISSUER_OK" != 1 ]; then
  echo "  ✗ ISSUER failed to start listening within 8s. Log:"
  sed 's/^/      /' "$ISSUER_LOG"
  exit 1
fi
if [ "$VERIFIER_OK" != 1 ]; then
  echo "  ✗ VERIFIER failed to start listening within 8s. Log:"
  sed 's/^/      /' "$VERIFIER_LOG"
  exit 1
fi
echo "  ✓ both servers listening on localhost"

# Sanity check: actually hit each server
ISSUER_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3001/.well-known/openid-credential-issuer 2>/dev/null || echo "FAIL")
VERIFIER_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3002/ 2>/dev/null || echo "FAIL")
echo "    GET localhost:3001/.well-known/openid-credential-issuer  -> $ISSUER_HTTP"
echo "    GET localhost:3002/                                       -> $VERIFIER_HTTP"
if [ "$ISSUER_HTTP" != "200" ] || [ "$VERIFIER_HTTP" != "200" ]; then
  echo "  ✗ at least one server isn't responding 200. Tail logs:"
  echo "  --- issuer ---"
  tail -10 "$ISSUER_LOG" | sed 's/^/      /'
  echo "  --- verifier ---"
  tail -10 "$VERIFIER_LOG" | sed 's/^/      /'
  exit 1
fi

# ---- Step 2: start cloudflared tunnels ----

echo ""
echo "[2] Starting cloudflared tunnels (one at a time to avoid Cloudflare rate-limit edge cases)..."
: > "$ISSUER_TUNNEL_LOG"
: > "$VERIFIER_TUNNEL_LOG"
echo "    [2a] starting issuer tunnel..."
cloudflared tunnel --url http://localhost:3001 > "$ISSUER_TUNNEL_LOG" 2>&1 &
ISSUER_TUNNEL_PID=$!
# Wait for issuer tunnel to actually register before kicking off the second.
# Cloudflared prints a URL early, then continues to register; if we slam two
# concurrent registrations, one sometimes fails NXDOMAIN.
for i in $(seq 1 30); do
  sleep 0.5
  if grep -q "Registered tunnel connection" "$ISSUER_TUNNEL_LOG" 2>/dev/null; then break; fi
  if ! kill -0 $ISSUER_TUNNEL_PID 2>/dev/null; then
    echo "  ✗ ISSUER tunnel died early. Log:"
    sed 's/^/      /' "$ISSUER_TUNNEL_LOG"
    exit 1
  fi
done
echo "    [2b] starting verifier tunnel..."
cloudflared tunnel --url http://localhost:3002 > "$VERIFIER_TUNNEL_LOG" 2>&1 &
VERIFIER_TUNNEL_PID=$!

echo "    waiting up to 25s for tunnel URLs..."
ISSUER_TUNNEL=""
VERIFIER_TUNNEL=""
for i in $(seq 1 50); do
  sleep 0.5
  if ! kill -0 $ISSUER_TUNNEL_PID 2>/dev/null; then
    echo "  ✗ ISSUER TUNNEL DIED. Log:"
    sed 's/^/      /' "$ISSUER_TUNNEL_LOG"
    exit 1
  fi
  if ! kill -0 $VERIFIER_TUNNEL_PID 2>/dev/null; then
    echo "  ✗ VERIFIER TUNNEL DIED. Log:"
    sed 's/^/      /' "$VERIFIER_TUNNEL_LOG"
    exit 1
  fi
  if [ -z "$ISSUER_TUNNEL" ]; then
    ISSUER_TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$ISSUER_TUNNEL_LOG" 2>/dev/null | head -1)
  fi
  if [ -z "$VERIFIER_TUNNEL" ]; then
    VERIFIER_TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$VERIFIER_TUNNEL_LOG" 2>/dev/null | head -1)
  fi
  if [ -n "$ISSUER_TUNNEL" ] && [ -n "$VERIFIER_TUNNEL" ]; then break; fi
done

if [ -z "$ISSUER_TUNNEL" ] || [ -z "$VERIFIER_TUNNEL" ]; then
  echo "  ✗ tunnel URLs didn't appear. Tunnel logs:"
  echo "  --- issuer tunnel ---"
  tail -20 "$ISSUER_TUNNEL_LOG" | sed 's/^/      /'
  echo "  --- verifier tunnel ---"
  tail -20 "$VERIFIER_TUNNEL_LOG" | sed 's/^/      /'
  exit 1
fi
echo "  ✓ issuer:   $ISSUER_TUNNEL"
echo "  ✓ verifier: $VERIFIER_TUNNEL"

# ---- Step 3: restart node servers with the tunnel URLs as their canonical URLs ----
# (Issuer/verifier metadata embeds the URL; needs the public tunnel URL.)

echo ""
echo "[3] Restarting servers with tunnel URLs as ISSUER_URL/VERIFIER_URL..."
kill $ISSUER_PID $VERIFIER_PID 2>/dev/null
wait $ISSUER_PID 2>/dev/null
wait $VERIFIER_PID 2>/dev/null
sleep 1
: > "$ISSUER_LOG"
: > "$VERIFIER_LOG"
ISSUER_URL="$ISSUER_TUNNEL" node issuer.mjs > "$ISSUER_LOG" 2>&1 &
ISSUER_PID=$!
VERIFIER_URL="$VERIFIER_TUNNEL" node verifier.mjs > "$VERIFIER_LOG" 2>&1 &
VERIFIER_PID=$!

echo "    waiting up to 8s for boot..."
ISSUER_OK=0
VERIFIER_OK=0
for i in $(seq 1 16); do
  sleep 0.5
  if ! kill -0 $ISSUER_PID 2>/dev/null; then
    echo "  ✗ ISSUER crashed on tunnel-URL boot. Log:"
    sed 's/^/      /' "$ISSUER_LOG"
    exit 1
  fi
  if ! kill -0 $VERIFIER_PID 2>/dev/null; then
    echo "  ✗ VERIFIER crashed on tunnel-URL boot. Log:"
    sed 's/^/      /' "$VERIFIER_LOG"
    exit 1
  fi
  if [ "$ISSUER_OK" = 0 ] && grep -q "listening on" "$ISSUER_LOG" 2>/dev/null; then ISSUER_OK=1; fi
  if [ "$VERIFIER_OK" = 0 ] && grep -q "listening on" "$VERIFIER_LOG" 2>/dev/null; then VERIFIER_OK=1; fi
  if [ "$ISSUER_OK" = 1 ] && [ "$VERIFIER_OK" = 1 ]; then break; fi
done
[ "$ISSUER_OK" = 1 ]   || { echo "  ✗ issuer didn't start"; tail -20 "$ISSUER_LOG"; exit 1; }
[ "$VERIFIER_OK" = 1 ] || { echo "  ✗ verifier didn't start"; tail -20 "$VERIFIER_LOG"; exit 1; }
echo "  ✓ both servers running with tunnel URLs"

# ---- Step 4: end-to-end reachability check via the tunnel ----

echo ""
echo "[4] End-to-end tunnel reachability (with retries; tunnel propagation can take a few seconds)..."
fetch_with_retries() {
  local url="$1"; local label="$2"
  for i in $(seq 1 8); do
    local code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 4 "$url" 2>/dev/null)
    if [ "$code" = "200" ]; then echo "  ✓ $label -> 200"; return 0; fi
    sleep 1
  done
  echo "  ⚠ $label -> not reachable from this shell (may still work from your browser)"
}
fetch_with_retries "$ISSUER_TUNNEL/.well-known/openid-credential-issuer" "issuer metadata"
fetch_with_retries "$VERIFIER_TUNNEL/"                                   "verifier UI"

cat <<EOF

==========================================================================
READY

Open in browser:
  Issuer UI:    $ISSUER_TUNNEL
  Verifier UI:  $VERIFIER_TUNNEL
  wwWallet:     https://demo.wwwallet.org

Live logs (in another terminal):
  tail -F $ISSUER_LOG
  tail -F $VERIFIER_LOG

Press Ctrl-C to stop.
==========================================================================
EOF

# Stream the logs into this terminal so you see activity in real time
tail -F "$ISSUER_LOG" "$VERIFIER_LOG" 2>/dev/null &
TAIL_PID=$!

wait $ISSUER_PID $VERIFIER_PID
