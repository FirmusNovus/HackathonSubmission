// =============================================================================
// Mutual-refund request workflow (F6).
// -----------------------------------------------------------------------------
// Both parties of an engagement must sign the SAME EIP-712 typed data
// (`MutualRefundAuthorization{engagementId, proposalIndex}`), then SOMEONE
// submits both sigs together via `mutualRefundProposal`. This module owns
// the multi-step coordination: an initiator signs and creates a request,
// the counterparty approves (signs) or rejects, and finally either party
// submits the now-fully-signed authorisation to the chain.
//
// State machine on `MutualRefundRequest.status`:
//
//     PENDING ─approve─▶ SIGNED_BOTH ─submit─▶ SUBMITTED
//        │                  │
//        └──reject──▶ REJECTED ◀──reject──┘
//
// Replay safety: the chain layer's Funded → Refunded transition is
// single-shot. A second submit on the same (engagementId, proposalIndex)
// trips InvalidProposalState because the proposal is no longer Funded — so
// status=SUBMITTED rows can never re-fire even if the API is bypassed.
// =============================================================================

import type { Hex } from "viem";
import type { Prisma } from "@prisma/client";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import {
  verifyMutualRefundSigForUser,
} from "@/lib/chain/eip712";
import { InvalidRefundSignature, InvalidProposalState } from "@/lib/chain/errors";

export const MUTUAL_REFUND_REQUEST_STATUS = {
  PENDING: "PENDING",
  SIGNED_BOTH: "SIGNED_BOTH",
  SUBMITTED: "SUBMITTED",
  REJECTED: "REJECTED",
} as const;
export type MutualRefundRequestStatus =
  (typeof MUTUAL_REFUND_REQUEST_STATUS)[keyof typeof MUTUAL_REFUND_REQUEST_STATUS];

const HEX_SIG = /^0x[0-9a-fA-F]{130}$/;
export function isValidSigHex(s: string | null | undefined): s is `0x${string}` {
  return typeof s === "string" && HEX_SIG.test(s);
}

/**
 * Resolve the engagement + parties + proposal in a single round-trip and
 * verify caller is one of them. Returns the loaded rows + which role the
 * caller plays. Throws if caller isn't a party.
 */
export async function loadEngagementContext(args: {
  engagementId: number;
  proposalIndex: number;
  callerUserId: string;
}) {
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: args.engagementId },
    include: { proposals: { where: { proposalIndex: args.proposalIndex } } },
  });
  if (!engagement) return { error: "EngagementNotFound" as const };
  const proposal = engagement.proposals[0];
  if (!proposal) return { error: "ProposalNotFound" as const };
  const [client, lawyer] = await Promise.all([
    prisma.user.findUnique({ where: { id: engagement.clientUserId } }),
    prisma.user.findUnique({ where: { id: engagement.lawyerUserId } }),
  ]);
  if (!client || !lawyer) return { error: "PartiesMissing" as const };

  let role: "client" | "lawyer" | null = null;
  if (args.callerUserId === client.id) role = "client";
  else if (args.callerUserId === lawyer.id) role = "lawyer";
  if (!role) return { error: "NotEngagementParty" as const };

  return { engagement, proposal, client, lawyer, role };
}

/**
 * Verify a signature against the expected party's wallet (with the dev-signer
 * fallback gated by NODE_ENV / ENABLE_MOCK_AUTH). Throws InvalidRefundSignature
 * on mismatch.
 */
export async function verifyPartySignature(args: {
  engagementId: number;
  proposalIndex: number;
  signature: string;
  party: { walletAddress: string; devSignerAddress: string | null };
}): Promise<void> {
  if (!isValidSigHex(args.signature)) throw new InvalidRefundSignature("malformed signature");
  await verifyMutualRefundSigForUser({
    message: {
      engagementId: BigInt(args.engagementId),
      proposalIndex: BigInt(args.proposalIndex),
    },
    signature: args.signature as Hex,
    walletAddress: args.party.walletAddress,
    devSignerAddress: args.party.devSignerAddress,
  });
}

/**
 * Find the active (non-terminal) refund request for a given (engagementId,
 * proposalIndex), if any. Used so the API can refuse to create a duplicate
 * PENDING / SIGNED_BOTH request when one is already in flight.
 */
export async function findActiveRequest(args: { engagementId: number; proposalIndex: number }) {
  return prisma.mutualRefundRequest.findFirst({
    where: {
      engagementId: args.engagementId,
      proposalIndex: args.proposalIndex,
      status: { in: [MUTUAL_REFUND_REQUEST_STATUS.PENDING, MUTUAL_REFUND_REQUEST_STATUS.SIGNED_BOTH] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Initiator signs and creates a fresh request. Validates the signature
 * against the initiator's wallet, asserts the proposal is currently FUNDED,
 * and refuses if an active request is already in flight.
 */
export async function createRefundRequest(args: {
  engagementId: number;
  proposalIndex: number;
  initiator: { id: string; walletAddress: string; devSignerAddress: string | null; role: "client" | "lawyer" };
  signature: string;
}) {
  // Proposal must be FUNDED — refund is the Funded → Refunded transition.
  // Delivered proposals must go through dispute, not mutual refund.
  const proposal = await prisma.proposal.findUnique({
    where: {
      engagementId_proposalIndex: {
        engagementId: args.engagementId,
        proposalIndex: args.proposalIndex,
      },
    },
  });
  if (!proposal) throw new InvalidProposalState(`No proposal at index ${args.proposalIndex}.`);
  if (proposal.state !== "FUNDED") {
    throw new InvalidProposalState(
      `Proposal[${args.proposalIndex}] is ${proposal.state}; mutual refund requires FUNDED.`,
    );
  }

  // Refuse if an active request already exists.
  const active = await findActiveRequest({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
  });
  if (active) {
    return { error: "ActiveRequestExists" as const, request: active };
  }

  // Real EIP-712 verification on the initiator's signature.
  await verifyPartySignature({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    signature: args.signature,
    party: args.initiator,
  });

  const created = await prisma.mutualRefundRequest.create({
    data: {
      engagementId: args.engagementId,
      proposalIndex: args.proposalIndex,
      initiatedBy: args.initiator.role === "client" ? Role.CLIENT : Role.LAWYER,
      clientSig: args.initiator.role === "client" ? args.signature : null,
      lawyerSig: args.initiator.role === "lawyer" ? args.signature : null,
      status: MUTUAL_REFUND_REQUEST_STATUS.PENDING,
    },
  });
  return { request: created };
}

/**
 * Counterparty approves a request by adding their signature. The caller
 * must NOT be the original initiator. Status flips to SIGNED_BOTH.
 *
 * The status flip is implemented as a CONDITIONAL update (`updateMany` with
 * `status: PENDING` in the where clause) so that a concurrent reject can't
 * lose: if reject runs first the row is REJECTED, the conditional update
 * matches zero rows, and we return InvalidStatus rather than silently
 * overwriting REJECTED → SIGNED_BOTH. SQLite serialises writes per-row, so
 * exactly one of the two racing writes wins.
 */
export async function approveRefundRequest(args: {
  requestId: string;
  approver: { id: string; walletAddress: string; devSignerAddress: string | null; role: "client" | "lawyer" };
  signature: string;
}) {
  const req = await prisma.mutualRefundRequest.findUnique({ where: { id: args.requestId } });
  if (!req) return { error: "NotFound" as const };
  if (req.status !== MUTUAL_REFUND_REQUEST_STATUS.PENDING) {
    return { error: "InvalidStatus" as const, status: req.status };
  }
  const initiatorRole = req.initiatedBy === Role.CLIENT ? "client" : "lawyer";
  if (args.approver.role === initiatorRole) {
    return { error: "InitiatorCannotApprove" as const };
  }

  await verifyPartySignature({
    engagementId: req.engagementId,
    proposalIndex: req.proposalIndex,
    signature: args.signature,
    party: args.approver,
  });

  const data: Prisma.MutualRefundRequestUpdateManyMutationInput = {
    status: MUTUAL_REFUND_REQUEST_STATUS.SIGNED_BOTH,
  };
  if (args.approver.role === "client") data.clientSig = args.signature;
  else data.lawyerSig = args.signature;

  const result = await prisma.mutualRefundRequest.updateMany({
    where: { id: req.id, status: MUTUAL_REFUND_REQUEST_STATUS.PENDING },
    data,
  });
  if (result.count === 0) {
    // Lost the race — somebody (reject, double-approve) already moved the
    // row off PENDING. Re-read to surface the new status.
    const fresh = await prisma.mutualRefundRequest.findUnique({ where: { id: req.id } });
    return { error: "InvalidStatus" as const, status: fresh?.status ?? "UNKNOWN" };
  }
  const updated = await prisma.mutualRefundRequest.findUnique({ where: { id: req.id } });
  return { request: updated! };
}

/**
 * Either party rejects a request. Idempotent on already-REJECTED rows.
 * SUBMITTED rows cannot be rejected (terminal state).
 *
 * Conditional update on `status IN (PENDING, SIGNED_BOTH)` so a concurrent
 * approve+submit can't be silently overwritten by a late reject — the late
 * call falls through to the post-condition check and surfaces the actual
 * terminal status to the caller.
 */
export async function rejectRefundRequest(args: {
  requestId: string;
  rejecterUserId: string;
  rejecterRole: "client" | "lawyer";
}) {
  const req = await prisma.mutualRefundRequest.findUnique({ where: { id: args.requestId } });
  if (!req) return { error: "NotFound" as const };
  if (req.status === MUTUAL_REFUND_REQUEST_STATUS.SUBMITTED) {
    return { error: "AlreadySubmitted" as const };
  }
  if (req.status === MUTUAL_REFUND_REQUEST_STATUS.REJECTED) {
    return { request: req }; // already rejected — no-op
  }
  const result = await prisma.mutualRefundRequest.updateMany({
    where: {
      id: req.id,
      status: { in: [MUTUAL_REFUND_REQUEST_STATUS.PENDING, MUTUAL_REFUND_REQUEST_STATUS.SIGNED_BOTH] },
    },
    data: { status: MUTUAL_REFUND_REQUEST_STATUS.REJECTED },
  });
  if (result.count === 0) {
    // Race lost — re-read to determine the actual terminal status.
    const fresh = await prisma.mutualRefundRequest.findUnique({ where: { id: req.id } });
    if (fresh?.status === MUTUAL_REFUND_REQUEST_STATUS.SUBMITTED) {
      return { error: "AlreadySubmitted" as const };
    }
    if (fresh?.status === MUTUAL_REFUND_REQUEST_STATUS.REJECTED) {
      return { request: fresh };
    }
    return { error: "NotFound" as const };
  }
  const updated = await prisma.mutualRefundRequest.findUnique({ where: { id: req.id } });
  return { request: updated! };
}

/**
 * Either party submits the fully-signed authorisation to the chain. Status
 * must be SIGNED_BOTH. On success, status → SUBMITTED and submitTxHash is
 * recorded.
 *
 * The chain call itself goes through `mutualRefundProposal` (real EIP-712
 * recovery), which writes the MutualRefundAuth row and flips the proposal
 * to Refunded. The booking-shell flip (CANCELLED) is the route handler's
 * responsibility because it depends on whether proposalIndex is the
 * consultation or a follow-up.
 */
export async function loadSubmittableRequest(requestId: string) {
  const req = await prisma.mutualRefundRequest.findUnique({ where: { id: requestId } });
  if (!req) return { error: "NotFound" as const };
  if (req.status !== MUTUAL_REFUND_REQUEST_STATUS.SIGNED_BOTH) {
    return { error: "InvalidStatus" as const, status: req.status };
  }
  if (!req.clientSig || !req.lawyerSig) {
    // Defensive — SIGNED_BOTH should imply both sigs present.
    return { error: "MissingSigs" as const };
  }
  return { request: req };
}

/**
 * Mark a request SUBMITTED conditionally on it still being SIGNED_BOTH. The
 * chain call has already happened by the time this runs; the conditional
 * filter is belt-and-suspenders for the rare case where a reject lands
 * between `loadSubmittableRequest` and the chain call. In that scenario the
 * proposal IS already Refunded on chain (the chain call consumed the sigs),
 * but we'd otherwise overwrite a REJECTED row with SUBMITTED. The
 * conditional update lets the post-condition surface the contradiction to
 * the route handler so it can return a clean error rather than silently
 * mutate a terminal row.
 */
export async function markRequestSubmitted(args: { requestId: string; txHash: string }) {
  const result = await prisma.mutualRefundRequest.updateMany({
    where: { id: args.requestId, status: MUTUAL_REFUND_REQUEST_STATUS.SIGNED_BOTH },
    data: {
      status: MUTUAL_REFUND_REQUEST_STATUS.SUBMITTED,
      submittedAt: new Date(),
      submitTxHash: args.txHash,
    },
  });
  const fresh = await prisma.mutualRefundRequest.findUnique({ where: { id: args.requestId } });
  if (result.count === 0) {
    // Defensive: status was no longer SIGNED_BOTH at flip time. Return the
    // current row state so the caller can surface the actual terminal status.
    return fresh!;
  }
  return fresh!;
}

export function refundRequestToWire(req: {
  id: string;
  engagementId: number;
  proposalIndex: number;
  initiatedBy: string;
  clientSig: string | null;
  lawyerSig: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  submitTxHash: string | null;
}) {
  return {
    id: req.id,
    engagementId: req.engagementId,
    proposalIndex: req.proposalIndex,
    initiatedBy: req.initiatedBy,
    hasClientSig: req.clientSig !== null,
    hasLawyerSig: req.lawyerSig !== null,
    status: req.status,
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
    submittedAt: req.submittedAt?.toISOString() ?? null,
    submitTxHash: req.submitTxHash,
  };
}
