// Owner spec: 001-verified-legal-engagement.
// Two ES256 P-256 signing keys — one for PID, one for bar. Generated on first
// boot under data/{pid,bar}-signing-key.jwk; persisted across restarts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { generateKeyPair, exportJWK, importJWK, type JWK, type KeyLike } from 'jose';

export type CredentialType = 'pid' | 'bar';

const DATA_DIR = resolve(process.cwd(), 'data');

function pathFor(type: CredentialType): string {
  return join(DATA_DIR, `${type}-signing-key.jwk`);
}

export async function ensureKey(type: CredentialType): Promise<JWK> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const path = pathFor(type);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8')) as JWK;
  }
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  jwk.kid = `${type}-${Date.now()}`;
  writeFileSync(path, JSON.stringify(jwk, null, 2), { mode: 0o600 });
  return jwk;
}

export function readJwk(type: CredentialType): JWK {
  const path = pathFor(type);
  if (!existsSync(path)) {
    throw new Error(`${type} signing key missing at ${path}; run \`pnpm seed\` first`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as JWK;
}

export function readPublicJwk(type: CredentialType): JWK {
  const priv = readJwk(type);
  // Strip the private scalar.
  const { d: _d, ...pub } = priv as JWK & { d?: string };
  return pub;
}

export async function loadSigningKey(
  type: CredentialType,
): Promise<{ key: KeyLike; kid: string }> {
  const jwk = readJwk(type);
  const alg = (jwk.alg as string) ?? 'ES256';
  const key = await importJWK(jwk, alg);
  return { key: key as KeyLike, kid: jwk.kid as string };
}

/** The HTTPS URL the issuer publishes as `iss` for a given credential type. */
export function issuerBaseUrl(type: CredentialType): string {
  const host = process.env.PUBLIC_HOSTNAME?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!host) throw new Error('PUBLIC_HOSTNAME not set');
  return `https://${host}/api/issuer/${type}`;
}
