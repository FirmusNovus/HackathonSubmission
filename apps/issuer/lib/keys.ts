// Owner spec: 001-verified-legal-engagement.
// Loads (or generates on first boot) the issuer's two ES256 P-256 signing
// JWKs — one for PID, one for bar.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateKeyPair, exportJWK } from 'jose';
import type { JWK } from 'jose';

const KEYS_DIR = resolve(process.cwd(), 'data');

export type CredentialType = 'pid' | 'bar';

interface KeyPairFile {
  privateJwk: JWK;
  publicJwk: JWK;
  kid: string;
}

function pathFor(type: CredentialType): string {
  return resolve(KEYS_DIR, `${type}-signing-key.jwk`);
}

export async function loadOrGenerateKey(type: CredentialType): Promise<KeyPairFile> {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  const path = pathFor(type);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8')) as KeyPairFile;
  }
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const kid = `${type}-${Date.now()}`;
  privateJwk.kid = kid;
  publicJwk.kid = kid;
  privateJwk.alg = 'ES256';
  publicJwk.alg = 'ES256';
  privateJwk.use = 'sig';
  publicJwk.use = 'sig';
  const file: KeyPairFile = { privateJwk, publicJwk, kid };
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  return file;
}

export async function publicJwks(type: CredentialType): Promise<{ keys: JWK[] }> {
  const k = await loadOrGenerateKey(type);
  return { keys: [k.publicJwk] };
}
