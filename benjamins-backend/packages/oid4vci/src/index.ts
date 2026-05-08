/**
 * OID4VCI flow primitives — pre-auth code state, token endpoint helpers,
 * holder-proof verification, and credential-offer state.
 *
 * Decoupled from any specific app's database connection: every function takes
 * the SQLite Database instance as its first argument. This lets the same
 * package be reused by independent issuer apps (bar, pid, …), each backing
 * its own SQLite file.
 */
import { randomBytes } from "node:crypto";
import { jwtVerify, type JWK, importJWK } from "jose";
import type Database from "better-sqlite3";

const ACCESS_TOKEN_TTL = 60 * 10; // 10 min

// ============================================================
// Required schema (each issuer app applies these tables in its migrations)
// ============================================================

export const ISSUER_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS issuer_pre_auth_codes (
    code            TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    persona_id      INTEGER NOT NULL,
    tx_code         TEXT,
    created_at      INTEGER NOT NULL,
    consumed_at     INTEGER
);

CREATE TABLE IF NOT EXISTS issuer_access_tokens (
    token           TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    persona_id      INTEGER NOT NULL,
    dpop_nonce      TEXT NOT NULL,
    c_nonce         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    issued_at       INTEGER
);

CREATE TABLE IF NOT EXISTS credential_offers (
    offer_id        TEXT PRIMARY KEY,
    pre_auth_code   TEXT NOT NULL UNIQUE REFERENCES issuer_pre_auth_codes(code) ON DELETE CASCADE,
    created_at      INTEGER NOT NULL
);
`;

// ============================================================
// Pre-auth codes
// ============================================================

export interface NewPreAuthArgs {
  kind: string;
  personaId: number;
  txCode?: string;
}

export function mintPreAuthCode(db: Database.Database, args: NewPreAuthArgs): string {
  const code = randomBytes(24).toString("base64url");
  db.prepare(
    `INSERT INTO issuer_pre_auth_codes (code, kind, persona_id, tx_code, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(code, args.kind, args.personaId, args.txCode ?? null, Math.floor(Date.now() / 1000));
  return code;
}

export interface PreAuthRow {
  code: string;
  kind: string;
  persona_id: number;
  tx_code: string | null;
  created_at: number;
  consumed_at: number | null;
}

function consumePreAuthCode(db: Database.Database, code: string, txCode?: string): PreAuthRow | null {
  const row = db
    .prepare(`SELECT * FROM issuer_pre_auth_codes WHERE code = ?`)
    .get(code) as PreAuthRow | undefined;
  if (!row) return null;
  if (row.consumed_at) return null;
  if (row.tx_code && row.tx_code !== (txCode ?? "")) return null;
  db.prepare(`UPDATE issuer_pre_auth_codes SET consumed_at = ? WHERE code = ?`).run(
    Math.floor(Date.now() / 1000),
    code
  );
  return row;
}

// ============================================================
// Access tokens
// ============================================================

export interface AccessTokenIssue {
  access_token: string;
  c_nonce: string;
  dpop_nonce: string;
  kind: string;
  personaId: number;
  expiresIn: number;
}

export function issueAccessToken(
  db: Database.Database,
  preAuthCode: string,
  txCode?: string
): AccessTokenIssue | null {
  const row = consumePreAuthCode(db, preAuthCode, txCode);
  if (!row) return null;
  const access_token = randomBytes(32).toString("base64url");
  const c_nonce = randomBytes(16).toString("base64url");
  const dpop_nonce = randomBytes(16).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO issuer_access_tokens (token, kind, persona_id, dpop_nonce, c_nonce, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(access_token, row.kind, row.persona_id, dpop_nonce, c_nonce, now, now + ACCESS_TOKEN_TTL);
  return {
    access_token,
    c_nonce,
    dpop_nonce,
    kind: row.kind,
    personaId: row.persona_id,
    expiresIn: ACCESS_TOKEN_TTL,
  };
}

export interface AccessTokenRow {
  token: string;
  kind: string;
  persona_id: number;
  dpop_nonce: string;
  c_nonce: string;
  created_at: number;
  expires_at: number;
  issued_at: number | null;
}

export function readAccessToken(db: Database.Database, token: string): AccessTokenRow | null {
  return (
    (db.prepare(`SELECT * FROM issuer_access_tokens WHERE token = ?`).get(token) as
      | AccessTokenRow
      | undefined) ?? null
  );
}

export function markIssued(db: Database.Database, token: string): void {
  db.prepare(`UPDATE issuer_access_tokens SET issued_at = ? WHERE token = ?`).run(
    Math.floor(Date.now() / 1000),
    token
  );
}

// ============================================================
// Credential offers
// ============================================================

export interface CreatedOffer {
  offerId: string;
  preAuthCode: string;
}

export function createOffer(
  db: Database.Database,
  kind: string,
  personaId: number
): CreatedOffer {
  const preAuthCode = mintPreAuthCode(db, { kind, personaId });
  const offerId = randomBytes(8).toString("hex");
  db.prepare(
    `INSERT INTO credential_offers (offer_id, pre_auth_code, created_at) VALUES (?, ?, ?)`
  ).run(offerId, preAuthCode, Math.floor(Date.now() / 1000));
  return { offerId, preAuthCode };
}

export interface OfferRecord {
  offer_id: string;
  pre_auth_code: string;
  kind: string;
  persona_id: number;
}

export function readOfferById(db: Database.Database, offerId: string): OfferRecord | null {
  const row = db
    .prepare(
      `SELECT o.offer_id, o.pre_auth_code, c.kind, c.persona_id
       FROM credential_offers o
       JOIN issuer_pre_auth_codes c ON c.code = o.pre_auth_code
       WHERE o.offer_id = ?`
    )
    .get(offerId) as OfferRecord | undefined;
  return row ?? null;
}

// ============================================================
// Holder-binding proof verification (no DB needed)
// ============================================================

export async function verifyHolderProofs(
  proofsJwt: string[],
  expectedNonce: string,
  expectedAudience: string
): Promise<JWK[]> {
  const out: JWK[] = [];
  for (const jwt of proofsJwt) {
    const [headerB64] = jwt.split(".");
    const header = JSON.parse(b64UrlToText(headerB64)) as { jwk?: JWK; alg?: string };
    if (!header.jwk) throw new Error("proof JWT header missing jwk");
    const key = await importJWK(header.jwk, header.alg ?? "ES256");
    const { payload } = await jwtVerify(jwt, key, { audience: expectedAudience });
    if ((payload as { nonce?: string }).nonce !== expectedNonce) {
      throw new Error("proof nonce mismatch");
    }
    out.push(header.jwk);
  }
  return out;
}

function b64UrlToText(b64: string): string {
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
