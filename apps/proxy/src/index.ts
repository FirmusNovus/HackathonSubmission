// Owner spec: 001-verified-legal-engagement.
// Path-routed reverse proxy: /api/issuer/* and /issuer/* go to the issuer
// (port 3001); everything else goes to the platform (port 3010). The wallet
// sees a single ngrok-fronted origin (FR-061a / single-hostname constraint).

import http from 'node:http';
import { URL } from 'node:url';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3000);
const ISSUER_TARGET = process.env.ISSUER_TARGET ?? 'http://127.0.0.1:3001';
const PLATFORM_TARGET = process.env.PLATFORM_TARGET ?? 'http://127.0.0.1:3010';

function pickTarget(reqUrl: string): string {
  if (reqUrl.startsWith('/api/issuer/') || reqUrl === '/api/issuer' || reqUrl.startsWith('/issuer/') || reqUrl === '/issuer') {
    return ISSUER_TARGET;
  }
  return PLATFORM_TARGET;
}

const server = http.createServer((req, res) => {
  const target = pickTarget(req.url ?? '/');
  const parsed = new URL(req.url ?? '/', target);
  const headers = { ...req.headers };
  // Forward original host so SIWE / OID4V* see the public hostname.
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
