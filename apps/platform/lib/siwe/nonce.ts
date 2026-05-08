// Owner spec: 001-verified-legal-engagement.

import { getDb } from '../db/client';
import { randomBytes } from 'node:crypto';

export function generateNonce(): string {
  const nonce = randomBytes(16).toString('hex');
  const db = getDb();
  db.prepare(`INSERT INTO nonces (nonce, used, created_at) VALUES (?, 0, ?)`).run(
    nonce,
    Math.floor(Date.now() / 1000),
  );
  return nonce;
}

export function consumeNonce(nonce: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT used FROM nonces WHERE nonce = ?`).get(nonce) as
    | { used: number }
    | undefined;
  if (!row || row.used) return false;
  db.prepare(`UPDATE nonces SET used = 1 WHERE nonce = ?`).run(nonce);
  return true;
}
