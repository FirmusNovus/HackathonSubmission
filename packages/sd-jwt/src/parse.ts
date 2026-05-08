/**
 * SD-JWT VC parsing + verification. Owner spec: 001-verified-legal-engagement.
 *
 * Envelope format: <JWS>~<Disclosure1>~<Disclosure2>~...~<KB-JWT>
 * Disclosures are base64url-encoded JSON arrays:
 *   - object disclosure: [salt, claim_name, value]
 *   - array disclosure:  [salt, value]
 *
 * Verification:
 *   1. JWS signature against issuer JWKS (kid → JWK lookup)
 *   2. Each disclosure's SHA-256 must appear in some `_sd` array in payload
 *   3. KB-JWT signature against `cnf.jwk` from the JWS payload
 *   4. KB-JWT `aud` must equal verifier's client_id
 *   5. KB-JWT `nonce` must equal verifier's request nonce
 */
import { type JWK, importJWK, jwtVerify } from 'jose';

const dec = new TextDecoder();
const enc = new TextEncoder();

export interface ParsedEnvelope {
  jws: string;
  disclosures: string[];
  kbJwt: string | null;
}

export interface VerifiedSdJwtVc {
  vct: string;
  issuer: string;
  disclosed: Record<string, unknown>;
  holderJwk: JWK;
  iat?: number;
  exp?: number;
}

export class SdJwtVerifyError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split('~');
  if (parts.length < 1) throw new SdJwtVerifyError('empty envelope');
  const jws = parts[0]!;
  if (parts.length === 1) return { jws, disclosures: [], kbJwt: null };
  const last = parts[parts.length - 1]!;
  const hasKb = last.split('.').length === 3 && last.length > 0;
  const kbJwt = hasKb ? last : null;
  const disclosures = parts.slice(1, parts.length - 1).filter(Boolean);
  return { jws, disclosures, kbJwt };
}

export function decodeDisclosure(b64: string): unknown[] {
  const padded = b64
    .padEnd(Math.ceil(b64.length / 4) * 4, '=')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const buf = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(dec.decode(buf)) as unknown[];
}

export async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function verifySdJwtVc(args: {
  envelope: string;
  issuerJwks: { keys: JWK[] };
  expectedAudience: string;
  expectedNonce: string;
}): Promise<VerifiedSdJwtVc> {
  const { envelope, issuerJwks, expectedAudience, expectedNonce } = args;
  const { jws, disclosures, kbJwt } = parseEnvelope(envelope);

  const [headerB64] = jws.split('.');
  if (!headerB64) throw new SdJwtVerifyError('malformed JWS');
  const header = JSON.parse(b64UrlToText(headerB64)) as { alg?: string; kid?: string };
  const issuerJwk =
    issuerJwks.keys.find((k) => !header.kid || k.kid === header.kid) ?? issuerJwks.keys[0];
  if (!issuerJwk) throw new SdJwtVerifyError('no matching issuer JWK');

  const issuerKey = await importJWK(issuerJwk, header.alg ?? 'ES256');
  let payload: Record<string, unknown>;
  try {
    const r = await jwtVerify(jws, issuerKey);
    payload = r.payload as Record<string, unknown>;
  } catch (e) {
    throw new SdJwtVerifyError(`issuer signature invalid: ${(e as Error).message}`);
  }

  const disclosed: Record<string, unknown> = {};
  for (const dB64 of disclosures) {
    const arr = decodeDisclosure(dB64);
    const digest = await sha256B64(dB64);
    const path = sdPathOfDigest(payload, digest);
    if (!path) throw new SdJwtVerifyError(`disclosure ${digest.slice(0, 8)} not present in _sd`);
    if (arr.length === 3) {
      const [, name, value] = arr as [string, string, unknown];
      insertAtPath(disclosed, [...path, name], value);
    }
  }

  for (const k of ['vct', 'iss', 'iat', 'exp']) {
    if (k in payload && !(k in disclosed)) {
      (disclosed as Record<string, unknown>)[k] = payload[k];
    }
  }

  const cnf = (payload as { cnf?: { jwk?: JWK } }).cnf;
  if (!cnf?.jwk) throw new SdJwtVerifyError('payload.cnf.jwk missing');
  if (!kbJwt) throw new SdJwtVerifyError('KB-JWT missing');

  const holderKey = await importJWK(cnf.jwk, 'ES256');
  let kbPayload: Record<string, unknown>;
  try {
    const r = await jwtVerify(kbJwt, holderKey, { audience: expectedAudience });
    kbPayload = r.payload as Record<string, unknown>;
  } catch (e) {
    throw new SdJwtVerifyError(`KB-JWT signature/audience invalid: ${(e as Error).message}`);
  }
  if ((kbPayload as { nonce?: string }).nonce !== expectedNonce) {
    throw new SdJwtVerifyError('KB-JWT nonce mismatch');
  }

  return {
    vct: payload.vct as string,
    issuer: payload.iss as string,
    disclosed,
    holderJwk: cnf.jwk,
    iat: payload.iat as number | undefined,
    exp: payload.exp as number | undefined,
  };
}

function sdPathOfDigest(obj: unknown, digest: string, path: string[] = []): string[] | null {
  if (obj === null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o._sd) && (o._sd as string[]).includes(digest)) return path;
  for (const [k, v] of Object.entries(o)) {
    if (k === '_sd' || k === '_sd_alg') continue;
    const found = sdPathOfDigest(v, digest, [...path, k]);
    if (found) return found;
  }
  return null;
}

function insertAtPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    target[path[0]!] = value;
    return;
  }
  const [head, ...rest] = path;
  if (typeof target[head!] !== 'object' || target[head!] === null) {
    target[head!] = {};
  }
  insertAtPath(target[head!] as Record<string, unknown>, rest, value);
}

function b64UrlToText(b64: string): string {
  const padded = b64
    .padEnd(Math.ceil(b64.length / 4) * 4, '=')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bin = atob(padded);
  return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
