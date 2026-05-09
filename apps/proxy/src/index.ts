// Owner spec: 001-verified-legal-engagement.
// Path-routed reverse proxy: /api/issuer/* and /issuer/* go to the issuer
// (port 3001); everything else goes to the platform (port 3010). The wallet
// sees a single ngrok-fronted origin (FR-061a / single-hostname constraint).
//
// User-facing issuer pages live at the issuer's `/` root; the proxy strips
// the `/issuer` prefix on those non-API routes before forwarding so the
// issuer's Next.js doesn't need a basePath (its OID4VCI well-known URLs are
// hard-coded as /api/issuer/{pid,bar}/...).

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
  // /api/issuer/* — forward as-is to issuer.
  if (reqUrl.startsWith('/api/issuer/') || reqUrl === '/api/issuer') {
    return { target: ISSUER_TARGET, rewrittenPath: reqUrl };
  }
  // /issuer/* — forward to issuer with /issuer stripped, so /issuer hits the
  // issuer's `/` (its landing page) and /issuer/_next/... hits the issuer's
  // /_next/... assets.
  if (reqUrl === '/issuer' || reqUrl === '/issuer/') {
    return { target: ISSUER_TARGET, rewrittenPath: '/' };
  }
  if (reqUrl.startsWith('/issuer/')) {
    return { target: ISSUER_TARGET, rewrittenPath: reqUrl.slice('/issuer'.length) };
  }
  // Everything else → platform.
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
