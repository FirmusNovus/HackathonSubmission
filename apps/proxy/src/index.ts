/**
 * Path-routed reverse proxy fronting the two Firmus Novus services.
 *
 *   /issuer/*          → @firmus/issuer  (port ISSUER_PORT,   default 3001)
 *   /api/issuer/*      → @firmus/issuer  (legacy direct paths, same target)
 *   *                  → @firmus/web     (port PLATFORM_PORT, default 3010)
 *
 * Listens on PROXY_PORT (default 3000) so the existing ngrok config
 * (`ngrok http 3000`) keeps working unchanged.
 *
 * Why a proxy at all? Two independent processes (platform + issuer) behind one
 * origin. Process-level isolation makes it visually and operationally clear
 * that the platform never sees credential data — it lives in the issuer's own
 * SQLite + signing keys. The wallet, meanwhile, sees a single host: the
 * SD-JWT VC's `iss` URL is `https://<host>/issuer/api/issuer/<kind>` and the
 * wallet fetches `.well-known/jwks.json` over the same origin.
 */
import http from "node:http";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3000);
const ISSUER_PORT = Number(process.env.ISSUER_PORT ?? 3001);
const PLATFORM_PORT = Number(process.env.PLATFORM_PORT ?? 3010);

const proxy = httpProxy.createProxyServer({
  // Preserve Host header so Next.js sees the original ngrok hostname (used in
  // PUBLIC_HOSTNAME-derived URLs, SIWE domain check, x509 client_id, etc.).
  changeOrigin: false,
  // xfwd:false — ngrok already populates X-Forwarded-* upstream. Re-adding
  // would append another value (`https,http`) which NextAuth chokes on.
  xfwd: false,
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy] error:", err.message);
  if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
    (res as http.ServerResponse).writeHead(502, { "Content-Type": "application/json" });
    (res as http.ServerResponse).end(JSON.stringify({ error: "bad_gateway", reason: err.message }));
  }
});

function pickTarget(url: string): string {
  // Anything under the `/issuer` basePath belongs to the issuer process. The
  // basePath also covers the issuer's _next chunks (/issuer/_next/...) and its
  // API routes (/issuer/api/issuer/{pid,bar}/...).
  if (url.startsWith("/issuer/") || url === "/issuer") {
    return `http://127.0.0.1:${ISSUER_PORT}`;
  }
  // Legacy direct API paths (no basePath). Useful if anything still hits
  // the OID4VCI-canonical /api/issuer/{kind}/* path; forward unchanged.
  if (url.startsWith("/api/issuer/")) {
    return `http://127.0.0.1:${ISSUER_PORT}`;
  }
  return `http://127.0.0.1:${PLATFORM_PORT}`;
}

const server = http.createServer((req, res) => {
  const target = pickTarget(req.url ?? "/");
  proxy.web(req, res, { target });
});

// Track every open socket — including upgraded WebSockets from Next.js HMR —
// so we can destroy them on shutdown. Without this, `server.close()` waits
// for the HMR connections to die naturally and the process never exits.
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
  console.log(`  /issuer/*     → :${ISSUER_PORT}`);
  console.log(`  /api/issuer/* → :${ISSUER_PORT}`);
  console.log(`  *             → :${PLATFORM_PORT}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[proxy] received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
  for (const s of openSockets) s.destroy();
  setTimeout(() => {
    console.warn("[proxy] grace period elapsed; forcing exit");
    process.exit(0);
  }, 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
