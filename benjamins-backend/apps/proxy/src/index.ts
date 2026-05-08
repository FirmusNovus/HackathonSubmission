/**
 * Path-routed reverse proxy fronting the three Lex Nova services.
 *
 *   /api/issuer/bar/*  → bar-issuer  (port BAR_ISSUER_PORT,  default 3001)
 *   /api/issuer/pid/*  → pid-issuer  (port PID_ISSUER_PORT,  default 3002)
 *   *                  → platform    (port PLATFORM_PORT,    default 3010)
 *
 * Listens on PROXY_PORT (default 3000) so the existing ngrok config
 * (`ngrok http 3000`) keeps working with no changes.
 *
 * Why three services behind one origin? ngrok free tier doesn't ship subdomains;
 * we need everything to resolve under the single reserved hostname. Path-based
 * routing here gives us process-level isolation (separate DBs, signing keys,
 * Node processes) while keeping the wallet's view of the world coherent — the
 * SD-JWT VC's `iss` URL is just `https://<host>/api/issuer/<kind>` and the
 * wallet fetches `.well-known/jwks.json` over the same host.
 */
import http from "node:http";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3000);
const BAR_ISSUER_PORT = Number(process.env.BAR_ISSUER_PORT ?? 3001);
const PID_ISSUER_PORT = Number(process.env.PID_ISSUER_PORT ?? 3002);
const PLATFORM_PORT = Number(process.env.PLATFORM_PORT ?? 3010);

const proxy = httpProxy.createProxyServer({
  // Preserve Host header so Next.js sees the original ngrok hostname (used in
  // PUBLIC_HOSTNAME-derived URLs, SIWE domain check, x509 client_id, etc.).
  changeOrigin: false,
  xfwd: true,
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy] error:", err.message);
  if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
    (res as http.ServerResponse).writeHead(502, { "Content-Type": "application/json" });
    (res as http.ServerResponse).end(JSON.stringify({ error: "bad_gateway", reason: err.message }));
  }
});

function pickTarget(url: string): string {
  if (url.startsWith("/api/issuer/bar")) return `http://127.0.0.1:${BAR_ISSUER_PORT}`;
  if (url.startsWith("/api/issuer/pid")) return `http://127.0.0.1:${PID_ISSUER_PORT}`;
  return `http://127.0.0.1:${PLATFORM_PORT}`;
}

const server = http.createServer((req, res) => {
  const target = pickTarget(req.url ?? "/");
  proxy.web(req, res, { target });
});

// Track every open socket — including upgraded WebSockets from Next.js HMR —
// so we can destroy them on shutdown. Without this, `server.close()` waits
// for the HMR connections to die naturally and the process never exits, which
// is what `tsx watch` reports as "Previous process hasn't exited yet. Force
// killing…" on Ctrl+C.
const openSockets = new Set<Duplex>();
server.on("connection", (s) => {
  openSockets.add(s);
  s.on("close", () => openSockets.delete(s));
});

// Forward websocket upgrades (Next.js HMR).
server.on("upgrade", (req, socket, head) => {
  openSockets.add(socket);
  socket.on("close", () => openSockets.delete(socket));
  const target = pickTarget(req.url ?? "/");
  proxy.ws(req, socket, head, { target });
});

server.listen(PROXY_PORT, () => {
  console.log(`[proxy] listening on :${PROXY_PORT}`);
  console.log(`  /api/issuer/bar/* → :${BAR_ISSUER_PORT}`);
  console.log(`  /api/issuer/pid/* → :${PID_ISSUER_PORT}`);
  console.log(`  *                 → :${PLATFORM_PORT}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[proxy] received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
  // Force-close active connections so server.close()'s callback can fire.
  for (const s of openSockets) s.destroy();
  // Hard cap: if something is still holding the loop after 2s, exit anyway.
  setTimeout(() => {
    console.warn("[proxy] grace period elapsed; forcing exit");
    process.exit(0);
  }, 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
