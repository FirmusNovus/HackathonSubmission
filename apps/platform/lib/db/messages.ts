// Owner spec: 001-verified-legal-engagement.
// Server NEVER decrypts; this module persists ciphertext only.

import { getDb } from './client';

export interface MessageRow {
  id: number;
  engagement_id: number;
  sender_address: string;
  ciphertext: Buffer;
  iv: Buffer;
  salt: Buffer;
  signature: string;
  created_at: number;
  transcript_leaf_index: number;
  transcript_leaf_hash: string;
}

export interface InsertMessage {
  engagement_id: number;
  sender_address: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  signature: string;
  transcript_leaf_hash: string;
}

export function insertMessage(m: InsertMessage): MessageRow {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const last =
    (db
      .prepare(
        `SELECT COALESCE(MAX(transcript_leaf_index), -1) AS i FROM messages WHERE engagement_id = ?`,
      )
      .get(m.engagement_id) as { i: number }).i;
  const idx = last + 1;
  const r = db
    .prepare(
      `INSERT INTO messages (engagement_id, sender_address, ciphertext, iv, salt, signature, created_at, transcript_leaf_index, transcript_leaf_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.engagement_id,
      m.sender_address.toLowerCase(),
      Buffer.from(m.ciphertext),
      Buffer.from(m.iv),
      Buffer.from(m.salt),
      m.signature,
      now,
      idx,
      m.transcript_leaf_hash,
    );
  return {
    id: Number(r.lastInsertRowid),
    engagement_id: m.engagement_id,
    sender_address: m.sender_address.toLowerCase(),
    ciphertext: Buffer.from(m.ciphertext),
    iv: Buffer.from(m.iv),
    salt: Buffer.from(m.salt),
    signature: m.signature,
    created_at: now,
    transcript_leaf_index: idx,
    transcript_leaf_hash: m.transcript_leaf_hash,
  };
}

export function listMessages(engagementId: number, sinceId = 0): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE engagement_id = ? AND id > ? ORDER BY created_at ASC, id ASC`,
    )
    .all(engagementId, sinceId) as MessageRow[];
}
