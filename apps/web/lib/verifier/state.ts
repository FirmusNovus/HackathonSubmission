/**
 * VerifierState helpers — Prisma-backed.
 *
 * One row per credential-presentation request. Lifecycle:
 *   1. POST /api/verifier/request          → newState() + persistRequest()
 *   2. wallet POSTs vp_token to /response  → markVerified() | markRejected()
 *   3. client polls /result                → readState()
 *   4. once finalize consumes the disclosed attrs → redactVerifiedAttrs()
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";

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

export async function persistRequest(args: {
  state: string;
  kind: VerifierKind;
  nonce: string;
  requestJws: string;
}): Promise<void> {
  await prisma.verifierState.create({
    data: {
      state: args.state,
      kind: args.kind,
      nonce: args.nonce,
      requestJws: args.requestJws,
      status: "pending",
    },
  });
}

export async function readState(state: string): Promise<VerifierStateRow | null> {
  const row = await prisma.verifierState.findUnique({ where: { state } });
  if (!row) return null;
  return {
    state: row.state,
    kind: row.kind as VerifierKind,
    nonce: row.nonce,
    request_jws: row.requestJws,
    status: row.status as VerifierStatus,
    verified_attrs: row.verifiedAttrs,
    holder_jwk: row.holderJwk,
    rejected_reason: row.rejectedReason,
    created_at: Math.floor(row.createdAt.getTime() / 1000),
    completed_at: row.completedAt ? Math.floor(row.completedAt.getTime() / 1000) : null,
  };
}

export async function markVerified(
  state: string,
  verifiedAttrs: object,
  holderJwk: object,
): Promise<void> {
  await prisma.verifierState.update({
    where: { state },
    data: {
      status: "verified",
      verifiedAttrs: JSON.stringify(verifiedAttrs),
      holderJwk: JSON.stringify(holderJwk),
      completedAt: new Date(),
    },
  });
}

export async function markRejected(state: string, reason: string): Promise<void> {
  await prisma.verifierState.update({
    where: { state },
    data: {
      status: "rejected",
      rejectedReason: reason,
      completedAt: new Date(),
    },
  });
}

/**
 * Wipe disclosed attributes from a verified state row after finalization
 * has consumed them. The row stays for audit (status, completedAt) but the
 * cleartext disclosure is dropped.
 */
export async function redactVerifiedAttrs(state: string): Promise<void> {
  await prisma.verifierState.update({
    where: { state },
    data: { verifiedAttrs: null, holderJwk: null },
  });
}
