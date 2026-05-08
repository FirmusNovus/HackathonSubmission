// SD-JWT VC issuance helpers.
// Owner spec: 001-verified-legal-engagement.

import { SignJWT, importJWK } from 'jose';
import type { JWK } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

export interface SignSdJwtOptions {
  issuer: string;
  vct: string;
  subject: string;
  validFor?: number;
  jwk: JWK;
  kid?: string;
  /** keys whose value will be selectively-disclosable (added under _sd) */
  selectiveClaims: Record<string, unknown>;
  /** plain claims included verbatim in the JWT payload */
  plainClaims?: Record<string, unknown>;
  /** holder cnf.jwk binding */
  holderJwk?: JWK;
}

export interface IssuedSdJwt {
  serialized: string;
  jws: string;
  disclosures: string[];
}

export async function issueSdJwt(opts: SignSdJwtOptions): Promise<IssuedSdJwt> {
  const disclosures: string[] = [];
  const sdHashes: string[] = [];

  for (const [key, value] of Object.entries(opts.selectiveClaims)) {
    const salt = randomBytes(16).toString('base64url');
    const arr = [salt, key, value];
    const disclosure = Buffer.from(JSON.stringify(arr)).toString('base64url');
    disclosures.push(disclosure);
    sdHashes.push(createHash('sha256').update(disclosure).digest('base64url'));
  }

  const payload: Record<string, unknown> = {
    vct: opts.vct,
    iss: opts.issuer,
    sub: opts.subject,
    iat: Math.floor(Date.now() / 1000),
    _sd_alg: 'sha-256',
    _sd: sdHashes,
    ...(opts.plainClaims ?? {}),
  };
  if (opts.holderJwk) payload.cnf = { jwk: opts.holderJwk };

  const ttl = opts.validFor ?? 60 * 60 * 24 * 365;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  payload.exp = exp;

  const key = await importJWK(opts.jwk, 'ES256');
  const jws = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'dc+sd-jwt', ...(opts.kid ? { kid: opts.kid } : {}) })
    .sign(key);

  const serialized = `${jws}~${disclosures.join('~')}~`;
  return { serialized, jws, disclosures };
}
