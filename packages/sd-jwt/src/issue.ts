/**
 * Core SD-JWT VC issuance. Owner spec: 001-verified-legal-engagement.
 *
 * Builds a credential of the form:
 *   <JWS>~<Disclosure1>~<Disclosure2>~...~
 * (no KB-JWT — wallet appends that at presentation time).
 *
 * Per credential-shapes.md: `iss` MUST be an HTTPS URL (validated wwWallet
 * quirk; RFC 9207). `cnf.jwk` carries the holder's public key.
 *
 * Each disclosable claim becomes:
 *   1. A base64url-encoded disclosure: [salt, claim_name, value]
 *   2. A SHA-256 digest of that disclosure in the payload's `_sd` array
 *
 * Nested SD-frames (e.g. `address.country`, `age_equal_or_over.18`) are
 * supported via `nestedDisclosableClaims`: each parent gets its own `_sd`
 * array containing digests of its leaves.
 */
import { randomBytes } from 'node:crypto';
import { SignJWT, type JWK, type KeyLike } from 'jose';

const enc = new TextEncoder();

export interface SigningKey {
  key: KeyLike | Uint8Array;
  kid: string;
}

export interface IssueArgs {
  signingKey: SigningKey;
  vct: string;
  issuerHttpsUrl: string;
  holderCnfJwk: JWK;
  disclosableClaims: Record<string, unknown>;
  nestedDisclosableClaims?: Record<string, Record<string, unknown>>;
  expiresAtUnix?: number;
}

export interface IssuedCredential {
  envelope: string;
  jws: string;
  disclosures: string[];
}

export async function issueSdJwtVc(args: IssueArgs): Promise<IssuedCredential> {
  const { key, kid } = args.signingKey;
  const disclosureB64s: string[] = [];
  const topLevelSdDigests: string[] = [];
  const nestedPayload: Record<string, { _sd: string[] }> = {};

  for (const [name, value] of Object.entries(args.disclosableClaims)) {
    const salt = randomBytes(16).toString('base64url');
    const arr = JSON.stringify([salt, name, value]);
    const b64 = base64url(enc.encode(arr));
    disclosureB64s.push(b64);
    topLevelSdDigests.push(await sha256B64(b64));
  }

  if (args.nestedDisclosableClaims) {
    for (const [parent, children] of Object.entries(args.nestedDisclosableClaims)) {
      const childDigests: string[] = [];
      for (const [leafName, leafValue] of Object.entries(children)) {
        const salt = randomBytes(16).toString('base64url');
        const arr = JSON.stringify([salt, leafName, leafValue]);
        const b64 = base64url(enc.encode(arr));
        disclosureB64s.push(b64);
        childDigests.push(await sha256B64(b64));
      }
      nestedPayload[parent] = { _sd: childDigests };
    }
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = args.expiresAtUnix ?? issuedAt + 60 * 60 * 24 * 365 * 10;

  const jws = await new SignJWT({
    vct: args.vct,
    cnf: { jwk: args.holderCnfJwk },
    _sd: topLevelSdDigests,
    _sd_alg: 'sha-256',
    ...nestedPayload,
  })
    // typ "dc+sd-jwt" is the value wwWallet's parser accepts.
    .setProtectedHeader({ alg: 'ES256', typ: 'dc+sd-jwt', kid })
    .setIssuer(args.issuerHttpsUrl)
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(key);

  const envelope = [jws, ...disclosureB64s].join('~') + '~';
  return { envelope, jws, disclosures: disclosureB64s };
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
