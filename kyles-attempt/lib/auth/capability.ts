// =============================================================================
// Capability auth helpers.
// -----------------------------------------------------------------------------
// Thin wrappers over the F1 mock-chain `getLatestCapability` / `hasCapability`
// reads in `lib/chain/escrow.ts`. The wrappers exist so route handlers and
// server components can import a stable surface that doesn't drag the full
// escrow module (mostly Prisma write paths) into their bundle.
//
// The functions are the source of truth for "is this wallet a verified
// lawyer / client / operator?" — `LawyerProfile.verificationStatus` is now
// DERIVED from these (see `lawyerVerificationFromCapability`), not the
// inverse. The column stays for fast UI badge reads; admin VERIFY/REVOKE
// actions write the column AND mint/revoke the capability so they stay in
// sync.
// =============================================================================

import type { Capability } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getLatestCapability as chainGetLatestCapability, hasCapability } from "@/lib/chain/escrow";
import { SCHEMA_LAWYER, type SchemaId } from "@/lib/chain/schemas";

/**
 * True iff the subject has an active (unrevoked, unexpired) capability for
 * `schemaId`. This is a thin re-export so call sites don't need to import
 * from `lib/chain/escrow`.
 */
export async function hasVerifiedCapability(walletAddress: string, schemaId: SchemaId): Promise<boolean> {
  if (!walletAddress) return false;
  return hasCapability(walletAddress, schemaId);
}

/**
 * The latest unrevoked unexpired Capability row, or null. Returns null both
 * for "never attested" and "attested but later revoked / expired".
 */
export async function getLatestCapability(
  walletAddress: string,
  schemaId: SchemaId,
): Promise<Capability | null> {
  if (!walletAddress) return null;
  return chainGetLatestCapability(walletAddress, schemaId);
}

/**
 * Derive the verification-status column from the lawyer's SCHEMA_LAWYER
 * capability state. Mapping:
 *
 *   - active capability        → "VERIFIED"
 *   - capability ever existed
 *     but is now revoked /
 *     expired                  → "REVOKED"
 *   - LawyerProfile row exists
 *     but no capability ever
 *     issued                   → "PENDING"
 *   - the column is "REJECTED" → "REJECTED" (manual rejection — the operator
 *                                 used REJECT, no capability was minted, and
 *                                 the column was set; no capability row exists
 *                                 to flip back from)
 *
 * The caller passes the address; we take care of looking up the latest
 * capability + any historical row.
 */
export async function lawyerVerificationFromCapability(
  walletAddress: string,
): Promise<"VERIFIED" | "PENDING" | "REJECTED" | "REVOKED"> {
  if (!walletAddress) return "PENDING";
  const subj = walletAddress.toLowerCase();
  const active = await chainGetLatestCapability(subj, SCHEMA_LAWYER);
  if (active) return "VERIFIED";
  // No active capability — was there ever one?
  const any = await prisma.capability.findFirst({
    where: { subjectAddress: subj, schemaId: SCHEMA_LAWYER },
    orderBy: { issuedAt: "desc" },
  });
  if (any) return "REVOKED";
  return "PENDING";
}

/**
 * True iff the subject is the configured operator wallet. Mirrors A's
 * pattern of identifying the attestor by the wallet address itself. F7 may
 * tighten this by also requiring a SCHEMA_OPERATOR capability; for now
 * either signal is accepted.
 */
export async function isOperator(walletAddress: string): Promise<boolean> {
  if (!walletAddress) return false;
  const { OPERATOR_ADDRESS } = await import("@/lib/chain/escrow");
  if (walletAddress.toLowerCase() === OPERATOR_ADDRESS) return true;
  const { SCHEMA_OPERATOR } = await import("@/lib/chain/schemas");
  return hasCapability(walletAddress, SCHEMA_OPERATOR);
}
