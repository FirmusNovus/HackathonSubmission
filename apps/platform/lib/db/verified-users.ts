// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export interface VerifiedUser {
  eth_address: string;
  attested_role: 'client' | 'lawyer';
  attested_at: number;
  attestation_uid: string;
  disclosed_attrs: Record<string, unknown>;
  message_pubkey: string | null;
  revoked_at: number | null;
}

export function upsertVerifiedUser(row: Omit<VerifiedUser, 'disclosed_attrs'> & { disclosed_attrs: Record<string, unknown> }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO verified_users (eth_address, attested_role, attested_at, attestation_uid, disclosed_attrs, message_pubkey, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(eth_address, attested_role) DO UPDATE SET
       attested_at = excluded.attested_at,
       attestation_uid = excluded.attestation_uid,
       disclosed_attrs = excluded.disclosed_attrs,
       revoked_at = NULL`,
  ).run(
    row.eth_address.toLowerCase(),
    row.attested_role,
    row.attested_at,
    row.attestation_uid,
    JSON.stringify(row.disclosed_attrs),
    row.message_pubkey,
    row.revoked_at,
  );
}

export function getVerifiedUser(address: string, role: 'client' | 'lawyer'): VerifiedUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM verified_users WHERE eth_address = ? AND attested_role = ? AND revoked_at IS NULL`,
    )
    .get(address.toLowerCase(), role) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...(row as unknown as VerifiedUser),
    disclosed_attrs: JSON.parse(row.disclosed_attrs as string),
  };
}

export function setMessagePubkey(address: string, role: 'client' | 'lawyer', pubkey: string) {
  const db = getDb();
  db.prepare(
    `UPDATE verified_users SET message_pubkey = ? WHERE eth_address = ? AND attested_role = ?`,
  ).run(pubkey, address.toLowerCase(), role);
}
