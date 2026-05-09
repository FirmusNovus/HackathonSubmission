// Owner spec: 001-verified-legal-engagement.
// Path-routed reverse proxy: routes the wallet's /api/issuer/* and the
// browser's /issuer/* to the issuer process (port 3001); everything else
// goes to the platform (port 3010). The wallet sees a single
// ngrok-fronted origin (single-hostname constraint).
//
// The issuer's Next.js is mounted under basePath="/issuer" so its asset
// URLs (/_next/...) end up at /issuer/_next/... — those route back to the
// issuer naturally. To keep wwWallet-facing API URLs short
// (/api/issuer/{pid,bar}/...), we rewrite those into /issuer/api/issuer/...
// before forwarding so the issuer's basePath-aware router accepts them.

import http from 'node:http';
import { URL } from 'node:url';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3000);
const ISSUER_TARGET = process.env.ISSUER_TARGET ?? 'http://127.0.0.1:3001';
const PLATFORM_TARGET = process.env.PLATFORM_TARGET ?? 'http://127.0.0.1:3010';

interface RouteDecision {
  target: string;
  rewrittenPath: string;
}

function route(reqUrl: string): RouteDecision {
  // Wallet-facing OID4VCI URLs — keep short, add /issuer for the basePath.
  if (reqUrl.startsWith('/api/issuer/') || reqUrl === '/api/issuer') {
    return { target: ISSUER_TARGET, rewrittenPath: '/issuer' + reqUrl };
  }
  // Browser-facing issuer pages + assets — already include /issuer.
  if (reqUrl === '/issuer' || reqUrl === '/issuer/' || reqUrl.startsWith('/issuer/')) {
    return { target: ISSUER_TARGET, rewrittenPath: reqUrl };
  }
  return { target: PLATFORM_TARGET, rewrittenPath: reqUrl };
}

const server = http.createServer((req, res) => {
  const decision = route(req.url ?? '/');
  const parsed = new URL(decision.rewrittenPath, decision.target);
  const headers = { ...req.headers };
  if (process.env.PUBLIC_HOSTNAME) {
    headers['x-forwarded-host'] = process.env.PUBLIC_HOSTNAME.replace(/^https?:\/\//, '');
    headers['x-forwarded-proto'] = 'https';
  }
  const proxyReq = http.request(
    {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Upstream error: ${err.message}`);
  });
  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
  console.log(`[proxy] :${PROXY_PORT} → issuer=${ISSUER_TARGET} platform=${PLATFORM_TARGET}`);
});
