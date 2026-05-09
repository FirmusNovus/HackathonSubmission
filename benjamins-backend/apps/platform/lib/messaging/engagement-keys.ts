/**
 * Server-side helpers for the per-engagement messaging-key directory
 * (Phase 4 / T062).
 *
 * Each engagement party generates a P-256 keypair client-side at engagement
 * open and POSTs the *public* half here. The counterparty fetches it and
 * runs ECDH to derive a shared AES-GCM key locally. The platform NEVER sees
 * a private key — Constitution invariant 1.
 *
 * Address normalization: rows are keyed by lowercased address so a checksum
 * mismatch can't create a duplicate entry.
 */
import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";

export interface MessagingKeyRow {
  engagement_id: number;
  party_address: string;
  public_key_jwk: string; // JSON-stringified JWK (P-256, no 'd')
  created_at: number;
}

export function upsertMessagingKey(
  engagementId: number,
  partyAddress: string,
  publicKeyJwk: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO engagement_messaging_keys (engagement_id, party_address, public_key_jwk, created_at)
     VALUES (?, lower(?), ?, ?)
     ON CONFLICT(engagement_id, party_address) DO UPDATE SET
       public_key_jwk = excluded.public_key_jwk,
       created_at = excluded.created_at`
  ).run(engagementId, partyAddress, publicKeyJwk, Math.floor(Date.now() / 1000));
}

export function getMessagingKey(
  engagementId: number,
  partyAddress: string
): MessagingKeyRow | null {
  return (getDb()
    .prepare(
      `SELECT engagement_id, party_address, public_key_jwk, created_at
       FROM engagement_messaging_keys
       WHERE engagement_id = ? AND party_address = lower(?)`
    )
    .get(engagementId, partyAddress) as MessagingKeyRow | undefined) ?? null;
}

export function listMessagingKeys(engagementId: number): MessagingKeyRow[] {
  return getDb()
    .prepare(
      `SELECT engagement_id, party_address, public_key_jwk, created_at
       FROM engagement_messaging_keys
       WHERE engagement_id = ?`
    )
    .all(engagementId) as MessagingKeyRow[];
}

/**
 * Resolve a request_id to the on-chain engagement_id, plus the party
 * addresses on the off-chain row. Returns null if no engagement has opened
 * yet for the request.
 */
export interface EngagementOffChain {
  engagement_id: number;
  request_id: number | null;
  matter_id: number;
  client_address: string;
  lawyer_address: string;
  state: "active" | "closed";
}

export function getEngagementByRequest(
  db: Database.Database,
  requestId: number
): EngagementOffChain | null {
  return (db
    .prepare(
      `SELECT engagement_id, request_id, matter_id, client_address, lawyer_address, state
       FROM engagement_off_chain
       WHERE request_id = ?`
    )
    .get(requestId) as EngagementOffChain | undefined) ?? null;
}
