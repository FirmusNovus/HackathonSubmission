// Owner spec: 001-verified-legal-engagement.
// verifier_states helpers (table is created by lib/db/schema.ts).

import { randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db/client';

export type VerifierKind = 'bar' | 'pid';
export type VerifierStatus = 'pending' | 'verified' | 'rejected';

export interface VerifierStateRow {
  state: string;
  kind: VerifierKind;
  bound_address: string | null;
  request_jws: string;
  nonce: string;
  status: VerifierStatus;
  result_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export function newState(): { state: string; nonce: string } {
  return {
    state: randomBytes(16).toString('hex'),
    nonce: randomBytes(16).toString('hex'),
  };
}

export function persistRequest(args: {
  state: string;
  kind: VerifierKind;
  nonce: string;
  requestJws: string;
  boundAddress?: string | null;
}): void {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO verifier_states (state, kind, bound_address, request_jws, nonce, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(args.state, args.kind, args.boundAddress ?? null, args.requestJws, args.nonce, now, now, now + 600);
}

export function readState(state: string): VerifierStateRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM verifier_states WHERE state = ?`)
      .get(state) as VerifierStateRow | undefined) ?? null
  );
}

export function markVerified(state: string, result: object): void {
  getDb()
    .prepare(
      `UPDATE verifier_states SET status = 'verified', result_json = ?, updated_at = ? WHERE state = ?`,
    )
    .run(JSON.stringify(result), Math.floor(Date.now() / 1000), state);
}

export function markRejected(state: string, reason: string): void {
  getDb()
    .prepare(
      `UPDATE verifier_states SET status = 'rejected', error = ?, updated_at = ? WHERE state = ?`,
    )
    .run(reason, Math.floor(Date.now() / 1000), state);
}

export function clearResult(state: string): void {
  getDb().prepare(`UPDATE verifier_states SET result_json = NULL WHERE state = ?`).run(state);
}
