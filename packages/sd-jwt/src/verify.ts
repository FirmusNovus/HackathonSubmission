// SD-JWT VC verification.
// Owner spec: 001-verified-legal-engagement.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyResult, JWTPayload } from 'jose';
import { splitSdJwt } from './parse';

export interface VerifyOptions {
  issuerUrl: string;
  audience?: string;
}

export interface VerifyResult {
  payload: JWTPayload & { cnf?: { jwk?: Record<string, unknown> } };
  protectedHeader: Record<string, unknown>;
}

export async function verifySdJwt(
  serialized: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const parts = splitSdJwt(serialized);
  const jwks = createRemoteJWKSet(new URL(`${options.issuerUrl}/.well-known/jwks.json`));
  const result: JWTVerifyResult = await jwtVerify(parts.jws, jwks, {
    issuer: options.issuerUrl,
    audience: options.audience,
  });
  return {
    payload: result.payload as VerifyResult['payload'],
    protectedHeader: result.protectedHeader as Record<string, unknown>,
  };
}
