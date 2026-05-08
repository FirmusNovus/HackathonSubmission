// Owner spec: 001-verified-legal-engagement.
// Fetches the issuer's public JWKS over HTTP. Constitutionally separate
// from the issuer process (Inv 4); the platform NEVER reads the issuer's
// signing keys directly.

import type { JWK } from 'jose';

const cache = new Map<'pid' | 'bar', { keys: JWK[]; fetchedAt: number }>();
const TTL_MS = 60_000; // re-fetch every minute

export async function fetchIssuerJwks(kind: 'pid' | 'bar'): Promise<{ keys: JWK[] }> {
  const cached = cache.get(kind);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return { keys: cached.keys };
  }

  const host = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  // For internal fetches we can use the proxy (port 3000) which routes to
  // the issuer process. Or talk directly to the issuer at 127.0.0.1:3001.
  const url = process.env.ISSUER_INTERNAL_BASE
    ? `${process.env.ISSUER_INTERNAL_BASE}/api/issuer/${kind}/.well-known/jwks.json`
    : `${host}/api/issuer/${kind}/.well-known/jwks.json`;

  const res = await fetch(url, { headers: { 'ngrok-skip-browser-warning': '1' } });
  if (!res.ok) throw new Error(`issuer jwks fetch failed: ${res.status}`);
  const json = (await res.json()) as { keys: JWK[] };
  cache.set(kind, { keys: json.keys, fetchedAt: Date.now() });
  return json;
}
