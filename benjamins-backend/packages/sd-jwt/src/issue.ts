/**
 * Core SD-JWT VC issuance.
 *
 * Builds a credential of the form:
 *   <JWS>~<Disclosure1>~<Disclosure2>~...
 * (no KB-JWT — that's appended by the wallet at presentation time)
 *
 * Per credential-shapes.md: `iss` MUST be an HTTPS URL (validated wwWallet
 * quirk; RFC 9207). `cnf.jwk` carries the holder's public key for binding.
 *
 * Each disclosable claim becomes:
 *   1. A base64url-encoded disclosure: `[salt, claim_name, value]`
 *   2. A SHA-256 digest of that base64url string in the payload's `_sd` array
 *
 * The wallet, at presentation time, returns the JWS + the subset of disclosures
 * the verifier asked for + a KB-JWT signed by the holder.
 */
import { randomBytes } from "node:crypto";
import { SignJWT, type JWK, type KeyLike } from "jose";

const enc = new TextEncoder();

export interface SigningKey {
  /** The issuer's private signing key (jose KeyLike). */
  key: KeyLike | Uint8Array;
  /** The kid that goes in the JWS header. Must match a JWK in the issuer's JWKS endpoint. */
  kid: string;
}

export interface IssueArgs {
  /** The issuer's signing key + kid. Caller loads from disk/env/secret-manager. */
  signingKey: SigningKey;
  vct: string;
  issuerHttpsUrl: string;
  holderCnfJwk: JWK; // public half from the wallet's proof
  /**
   * Top-level claims that are individually disclosable. Each becomes one
   * disclosure of shape `[salt, name, value]` and one digest in the JWS
   * payload's top-level `_sd` array.
   */
  disclosableClaims: Record<string, unknown>;
  /**
   * Nested-object claims where each leaf inside is individually disclosable.
   * Used for EUDI PID structures like `address.country` and `age_equal_or_over.18`.
   * The JWS payload gets a structure like:
   *   { address: { _sd: ["<digest of country>"] }, age_equal_or_over: { _sd: ["<digest of 18>"] } }
   * and one disclosure per leaf of shape `[salt, leafName, leafValue]`.
   */
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

  // Top-level disclosable claims
  for (const [name, value] of Object.entries(args.disclosableClaims)) {
    const salt = randomBytes(16).toString("base64url");
    const arr = JSON.stringify([salt, name, value]);
    const b64 = base64url(enc.encode(arr));
    disclosureB64s.push(b64);
    topLevelSdDigests.push(await sha256B64(b64));
  }

  // Nested disclosable claims — each parent gets its own _sd array
  if (args.nestedDisclosableClaims) {
    for (const [parent, children] of Object.entries(args.nestedDisclosableClaims)) {
      const childDigests: string[] = [];
      for (const [leafName, leafValue] of Object.entries(children)) {
        const salt = randomBytes(16).toString("base64url");
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
    _sd_alg: "sha-256",
    ...nestedPayload,
  })
    // typ "dc+sd-jwt" is the value wwWallet's parser accepts (validated in spike).
    // The older "vc+sd-jwt" typ is still in some specs but wwWallet rejects it.
    .setProtectedHeader({ alg: "ES256", typ: "dc+sd-jwt", kid })
    .setIssuer(args.issuerHttpsUrl)
    .setIssuedAt(issuedAt)
    .setExpirationTime(exp)
    .sign(key);

  const envelope = [jws, ...disclosureB64s].join("~") + "~";
  return { envelope, jws, disclosures: disclosureB64s };
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
