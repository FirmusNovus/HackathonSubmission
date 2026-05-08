/**
 * verifier_states table helpers.
 */
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";

export type VerifierKind = "bar" | "pid";
export type VerifierStatus = "pending" | "verified" | "rejected";

export interface VerifierStateRow {
  state: string;
  kind: VerifierKind;
  nonce: string;
  request_jws: string;
  status: VerifierStatus;
  verified_attrs: string | null;
  holder_jwk: string | null;
  rejected_reason: string | null;
  created_at: number;
  completed_at: number | null;
}

export function newState(): { state: string; nonce: string } {
  return {
    state: randomBytes(16).toString("hex"),
    nonce: randomBytes(16).toString("hex"),
  };
}

export function persistRequest(args: { state: string; kind: VerifierKind; nonce: string; requestJws: string }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO verifier_states (state, kind, nonce, request_jws, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(args.state, args.kind, args.nonce, args.requestJws, Math.floor(Date.now() / 1000));
}

export function readState(state: string): VerifierStateRow | null {
  const db = getDb();
  return db
    .prepare("SELECT * FROM verifier_states WHERE state = ?")
    .get(state) as VerifierStateRow | undefined ?? null;
}

export function markVerified(state: string, verifiedAttrs: object, holderJwk: object) {
  const db = getDb();
  db.prepare(
    `UPDATE verifier_states
     SET status = 'verified', verified_attrs = ?, holder_jwk = ?, completed_at = ?
     WHERE state = ?`
  ).run(JSON.stringify(verifiedAttrs), JSON.stringify(holderJwk), Math.floor(Date.now() / 1000), state);
}

export function markRejected(state: string, reason: string) {
  const db = getDb();
  db.prepare(
    `UPDATE verifier_states
     SET status = 'rejected', rejected_reason = ?, completed_at = ?
     WHERE state = ?`
  ).run(reason, Math.floor(Date.now() / 1000), state);
}

/**
 * Wipes the disclosed attributes from a verified state row after finalization
 * has consumed them. The row stays for audit/debug (status, completed_at) but
 * the cleartext disclosure is dropped — we don't want it sitting around in
 * verifier_states once `verified_users.disclosed_attrs` has been written.
 */
export function redactVerifiedAttrs(state: string) {
  const db = getDb();
  db.prepare(
    `UPDATE verifier_states
     SET verified_attrs = NULL, holder_jwk = NULL
     WHERE state = ?`
  ).run(state);
}
