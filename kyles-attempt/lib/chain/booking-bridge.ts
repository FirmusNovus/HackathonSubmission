// =============================================================================
// Booking ↔ Engagement bridge (F3).
// -----------------------------------------------------------------------------
// This module is the single seam between System B's user-facing Booking shell
// and System A's Engagement + Proposal state machine. Each Booking maps 1:1
// to an Engagement, and that Engagement's `proposal[0]` IS the consultation
// proposal (paid amount or zero). The functions here are the only place in
// the API surface that mutates chain state on behalf of a Booking — route
// handlers should always call through here, never the chain layer directly.
//
// Stub ZK proof + nullifier — F11 wires real circuits. The stub MUST be
// deterministic per (client, lawyer, booking.id) so a re-attempt with the
// same inputs hits NullifierAlreadyUsed instead of double-opening. F11
// replaces these with real bb-generated witness + UltraHonk proof bytes.
// =============================================================================

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  disputeProposal,
  escalateProposal,
  markDelivered,
  mutualRefundProposal,
  openEngagementAndFundFirstProposal,
  openFreeEngagement,
  releaseProposal,
  resolveDispute,
} from "@/lib/chain/escrow";

// =============================================================================
// Inputs the bridge needs.
// =============================================================================

/**
 * The bridge accepts a thin shape rather than the full Booking type so it can
 * be reused from any handler that has a booking + the participants on hand.
 */
export type BookingBridgeInput = {
  id: string;
  caseDescription: string;
  practiceArea: string;
  consultationFeeEUR: Prisma.Decimal | number | string;
  /** Lower-cased Ethereum address. */
  clientWallet: string;
  /** Lower-cased Ethereum address. */
  lawyerWallet: string;
  /** Lawyer's bar jurisdiction (used to seed the matter-ref). */
  jurisdiction?: string | null;
  /** Existing engagementId, if the booking has already been opened. */
  engagementId?: number | null;
  /** Existing proposalIndex (0 for the consultation proposal). */
  proposalIndex?: number;
};

// =============================================================================
// Determinism seams (F11 swaps these for real circuits).
// =============================================================================

function sha256Hex(input: string): string {
  return "0x" + createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic 32-byte matterRef. Production replaces this with a Poseidon
 * commitment over the case-meta tuple so the on-chain anchor doesn't reveal
 * the inputs. SHA-256 here is fine for the mock — the contract checks shape
 * (bytes32) only, and we need the function to be reproducible from the
 * Booking row alone.
 */
export function matterRefFor(input: Pick<BookingBridgeInput, "id" | "caseDescription" | "practiceArea" | "jurisdiction">): string {
  const tuple = JSON.stringify({
    bookingId: input.id,
    caseDescription: input.caseDescription,
    practiceArea: input.practiceArea,
    jurisdiction: input.jurisdiction ?? "",
  });
  return sha256Hex("matterRef:" + tuple);
}

/**
 * Stub ZK conflict-of-interest nullifier. Deterministic per
 * (client, lawyer, bookingId) tuple so a retry with the same inputs is
 * correctly rejected as `NullifierAlreadyUsed` — same as the production
 * circuit's behaviour where the witness produces the same nullifier each time.
 *
 * F11: replace with the bb-generated UltraHonk nullifier from the
 * `conflict_of_interest` Noir circuit (`circuits/conflict_of_interest`).
 */
export function stubNullifier(input: Pick<BookingBridgeInput, "id" | "clientWallet" | "lawyerWallet">): string {
  return sha256Hex(
    "nullifier:" + input.clientWallet.toLowerCase() + ":" + input.lawyerWallet.toLowerCase() + ":" + input.id,
  );
}

/** Stub ZK proof bytes — F11 replaces with real UltraHonk proof bytes. */
export function stubProof(nullifier: string): string {
  return sha256Hex("proof:" + nullifier);
}

// =============================================================================
// Wei helpers — the platform stores EUR cents in the booking; the chain takes
// wei. For the mock we use the EUR-cents integer as the wei amount directly
// (1 EUR = 100 wei), which keeps amounts <= 2^53 safely and lets the UI
// recover EUR via `Number(amountWei) / 100`. F4 introduces a real
// EUR→token-amount conversion via the on-chain stablecoin's `decimals()`.
// =============================================================================

function eurToWei(amount: Prisma.Decimal | number | string): bigint {
  // Decimal -> string -> bigint(round). We round half-up to match contract
  // arithmetic conventions; the EUR amounts have at most 2 decimals.
  const asNum =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : Number(amount.toFixed(2));
  return BigInt(Math.round(asNum * 100));
}

// =============================================================================
// Open: free vs paid.
// =============================================================================

/**
 * Open the Engagement on the mock chain for this Booking and persist the
 * mapping back onto the Booking row. Idempotent on `engagementId !== null` —
 * a second call with an already-opened booking returns the existing mapping
 * without touching the chain.
 *
 * Routing:
 *   - consultationFeeEUR === 0 → `openFreeEngagement` (creates Proposal[0]
 *     with amountWei=0; lifecycle is uniform with the paid path)
 *   - consultationFeeEUR > 0   → `openEngagementAndFundFirstProposal`
 *
 * Both paths deterministically derive the (matterRef, nullifier, proof) from
 * the booking inputs so retries hit `NullifierAlreadyUsed` rather than
 * double-funding.
 */
export async function openEngagementForBooking(
  input: BookingBridgeInput,
): Promise<{ engagementId: number; proposalIndex: number; txHash: string; alreadyOpen: boolean }> {
  // Idempotency — booking already opened.
  if (input.engagementId != null) {
    const existing = await prisma.engagement.findUnique({
      where: { engagementId: input.engagementId },
      include: { proposals: true },
    });
    if (existing) {
      return {
        engagementId: existing.engagementId,
        proposalIndex: input.proposalIndex ?? 0,
        txHash: existing.openTxHash,
        alreadyOpen: true,
      };
    }
  }

  const matterRef = matterRefFor(input);
  const nullifier = stubNullifier(input);
  const zkProof = stubProof(nullifier);
  const fee = eurToWei(input.consultationFeeEUR);
  const isFree = fee === 0n;

  const result = isFree
    ? await openFreeEngagement({
        client: input.clientWallet,
        lawyer: input.lawyerWallet,
        matterRef,
        zkProof,
        zkNullifier: nullifier,
        from: input.clientWallet,
      })
    : await openEngagementAndFundFirstProposal({
        client: input.clientWallet,
        lawyer: input.lawyerWallet,
        matterRef,
        amountWei: fee,
        valueWei: fee,
        zkProof,
        zkNullifier: nullifier,
        from: input.clientWallet,
      });

  // Persist back onto the Booking. Note: status is NOT touched here — the
  // route handler decides what status flip (if any) accompanies the open.
  await prisma.booking.update({
    where: { id: input.id },
    data: {
      engagementId: result.engagementId,
      proposalIndex: result.proposalIndex,
      escrowTxHash: result.txHash,
    },
  });

  return {
    engagementId: result.engagementId,
    proposalIndex: result.proposalIndex,
    txHash: result.txHash,
    alreadyOpen: false,
  };
}

// =============================================================================
// State transitions through the bridge.
// =============================================================================

/** Lawyer marks the consultation deliverable. Mirrors Proposal.deliveredAt back onto the Booking. */
export async function markDeliveredForBooking(
  booking: { id: string; engagementId: number | null; proposalIndex: number },
  fromAddress: string,
): Promise<{ deliveredAt: Date; txHash: string }> {
  if (booking.engagementId == null) {
    throw new Error("Booking has no engagementId — chain open never happened.");
  }
  const result = await markDelivered({
    engagementId: booking.engagementId,
    proposalIndex: booking.proposalIndex,
    from: fromAddress,
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { deliveredAt: result.deliveredAt, status: "DELIVERED" },
  });
  return result;
}

/** Client releases the proposal — funds flow to the lawyer. Booking → COMPLETED. */
export async function releaseForBooking(
  booking: { id: string; engagementId: number | null; proposalIndex: number },
  fromAddress: string,
): Promise<{ txHash: string }> {
  if (booking.engagementId == null) {
    // Legacy bookings (seeded before F3) may not have an engagement. We let
    // the complete route fall back to a status-only flip in that case; the
    // caller decides. Throw here so callers handle it explicitly.
    throw new Error("Booking has no engagementId — cannot release on chain.");
  }
  const result = await releaseProposal({
    engagementId: booking.engagementId,
    proposalIndex: booking.proposalIndex,
    from: fromAddress,
  });
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "COMPLETED", escrowReleaseHash: result.txHash },
  });
  return result;
}

/**
 * Client disputes a proposal under this Booking's engagement. Mirrors
 * `LegalEngagementEscrow.disputeProposal` — the chain layer enforces the state
 * machine (proposal must be Funded or Delivered; engagement must be Active).
 *
 * F5: signature changed to accept the proposalIndex explicitly so the same
 * helper covers both proposal[0] (the consultation) and proposal[i>0] (a
 * funded follow-up). When the disputed proposal IS the consultation
 * (proposalIndex === booking.proposalIndex, i.e. proposal[0]), the Booking
 * shell is also flipped to DISPUTED so the dashboard surfaces it. For
 * follow-ups we leave the Booking row alone — only the Proposal row reflects
 * the dispute, mirroring how the contract treats them as independent.
 *
 * Refuses on a chain-state level: a CLOSED engagement throws
 * `InvalidEngagementState` from the chain layer; we let it bubble up so
 * callers can map to HTTP via `chainErrorToHttp`.
 */
export async function disputeForBooking(args: {
  booking: { id: string; engagementId: number | null; proposalIndex: number };
  proposalIndex: number;
  fromAddress: string;
  transcriptRoot: string;
}): Promise<{ txHash: string }> {
  const { booking, proposalIndex, fromAddress, transcriptRoot } = args;
  if (booking.engagementId == null) {
    throw new Error("Booking has no engagementId — cannot dispute on chain.");
  }
  const result = await disputeProposal({
    engagementId: booking.engagementId,
    proposalIndex,
    transcriptRoot,
    from: fromAddress,
  });
  // Only flip the Booking shell if the disputed proposal is the consultation
  // (proposal[0]). Follow-up disputes don't bubble up to the booking-level
  // status — they're proposal-scoped.
  if (proposalIndex === booking.proposalIndex) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "DISPUTED" },
    });
  }
  return result;
}

/**
 * Lawyer escalates a Delivered proposal to operator review after the 30-day
 * cooldown. Mirrors `LegalEngagementEscrow.escalateProposal` — the chain
 * layer enforces:
 *   - msg.sender == engagement.lawyer (NotEngagementLawyer otherwise),
 *   - proposal.state == Delivered (InvalidProposalState otherwise),
 *   - block.timestamp >= deliveredAt + 30 days (CooldownNotElapsed otherwise).
 *
 * `CooldownNotElapsed` carries the absolute `unlockAt` so the UI can render an
 * exact countdown; the route layer maps the throw to a 425 with that field.
 *
 * Same Booking-flip semantic as `disputeForBooking`: we only set Booking.status
 * to DISPUTED when the escalated proposal is proposal[0]. Follow-ups leave the
 * booking row alone.
 */
export async function escalateForBooking(args: {
  booking: { id: string; engagementId: number | null; proposalIndex: number };
  proposalIndex: number;
  fromAddress: string;
  transcriptRoot: string;
}): Promise<{ txHash: string }> {
  const { booking, proposalIndex, fromAddress, transcriptRoot } = args;
  if (booking.engagementId == null) {
    throw new Error("Booking has no engagementId — cannot escalate on chain.");
  }
  const result = await escalateProposal({
    engagementId: booking.engagementId,
    proposalIndex,
    transcriptRoot,
    from: fromAddress,
  });
  if (proposalIndex === booking.proposalIndex) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "DISPUTED" },
    });
  }
  return result;
}

/**
 * F5: dispute a follow-up proposal addressed only by `(engagementId,
 * proposalIndex)`. Mirrors `releaseForProposal` / `markDeliveredForProposal`
 * for the dispute path. The Booking row is unaffected — follow-ups don't
 * have a 1:1 booking shell.
 */
export async function disputeForProposal(args: {
  engagementId: number;
  proposalIndex: number;
  from: string;
  transcriptRoot: string;
}): Promise<{ txHash: string }> {
  return disputeProposal({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    transcriptRoot: args.transcriptRoot,
    from: args.from,
  });
}

/**
 * F5: lawyer-side counterpart — escalate a follow-up proposal after the
 * 30-day cooldown. Same chain semantics as `escalateForBooking`.
 */
export async function escalateForProposal(args: {
  engagementId: number;
  proposalIndex: number;
  from: string;
  transcriptRoot: string;
}): Promise<{ txHash: string }> {
  return escalateProposal({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    transcriptRoot: args.transcriptRoot,
    from: args.from,
  });
}

// =============================================================================
// F4: arbitrary-proposal helpers (follow-ups go through these). Booking-bridge
// versions above are still proposalIndex-aware but they always pull the index
// off the Booking row; these accept the index explicitly so a route handler
// holding a ProposalOffer (which knows its target engagement but not its
// proposal index until `fundProposal` returns it) can drive the state machine
// without touching the Booking shell.
// =============================================================================

/**
 * Lawyer marks a follow-up proposal delivered. Identical to
 * `markDeliveredForBooking` but addressed by `(engagementId, proposalIndex)`
 * tuple — the Booking row is unaffected because follow-up proposals don't
 * have a 1:1 booking shell.
 */
export async function markDeliveredForProposal(
  args: { engagementId: number; proposalIndex: number; from: string },
): Promise<{ deliveredAt: Date; txHash: string }> {
  return markDelivered({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    from: args.from,
  });
}

/**
 * Client releases a follow-up proposal — funds flow to the lawyer. Mirrors
 * `releaseForBooking` for arbitrary proposalIndex.
 */
export async function releaseForProposal(
  args: { engagementId: number; proposalIndex: number; from: string },
): Promise<{ txHash: string }> {
  return releaseProposal({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    from: args.from,
  });
}

/**
 * Mutual refund (both parties signed). Drives `mutualRefundProposal` on the
 * chain (real EIP-712 recovery in F6) and flips the Booking shell to
 * CANCELLED iff the refunded proposal IS the consultation (proposal[0]).
 * Follow-up refunds leave the booking row alone — only the Proposal row
 * reflects the refund. Mirrors `disputeForBooking`'s shell-flip semantic.
 */
export async function mutualRefundForBooking(
  booking: { id: string; engagementId: number | null; proposalIndex: number },
  args: {
    fromAddress: string;
    clientSig: string;
    lawyerSig: string;
    /** Defaults to booking.proposalIndex (the consultation). */
    proposalIndex?: number;
  },
): Promise<{ txHash: string }> {
  if (booking.engagementId == null) throw new Error("Booking has no engagementId — cannot refund on chain.");
  const proposalIndex = args.proposalIndex ?? booking.proposalIndex;
  const result = await mutualRefundProposal({
    engagementId: booking.engagementId,
    proposalIndex,
    clientSig: args.clientSig,
    lawyerSig: args.lawyerSig,
    from: args.fromAddress,
  });
  // Flip the booking shell only if the refunded proposal is proposal[0].
  if (proposalIndex === booking.proposalIndex) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });
  }
  return result;
}

/**
 * F6: arbitrary-proposal mutual refund — addressed by (engagementId,
 * proposalIndex) without touching any Booking shell. Used by the
 * proposal-id-keyed routes for follow-up proposal refunds.
 */
export async function mutualRefundForProposal(args: {
  engagementId: number;
  proposalIndex: number;
  clientSig: string;
  lawyerSig: string;
  from: string;
}): Promise<{ txHash: string }> {
  return mutualRefundProposal({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    clientSig: args.clientSig,
    lawyerSig: args.lawyerSig,
    from: args.from,
  });
}

// =============================================================================
// F7: operator dispute resolution.
// -----------------------------------------------------------------------------
// `resolveDispute` is the operator-only path that splits the parked amount
// between the lawyer and the client. The chain layer enforces sum-equality
// (`toLawyer + toClient == proposal.amountWei`) and operator-only access; the
// helpers here just wrap that for the bridge surface so route handlers don't
// reach into `lib/chain/escrow` directly.
//
// Booking-shell semantics for proposal[0] resolves:
//   The dispute is RESOLVED on chain regardless of the split. From the user's
//   point of view the engagement is closed — the funds have been adjudicated
//   and the booking can no longer transition. We always flip the booking
//   status to COMPLETED (terminal "this is over") rather than encoding split-
//   semantic information into the status enum, because:
//     - the actual split is informational and lives on the Proposal row
//       (`amountToLawyerWei` / `amountToClientWei`),
//     - downstream UI reads the proposal state machine for the "what happened"
//       — `RESOLVED` proposal means the booking is final regardless of who
//       got how much,
//     - keeping CANCELLED for refund-style outcomes (mutualRefund) and
//       COMPLETED for "the engagement is finished" matches the existing
//       semantics in the rest of the codebase.
//
// For follow-up proposals (proposalIndex>0) the booking shell is untouched —
// only the Proposal row reflects the resolution, mirroring how
// `disputeForBooking` and `mutualRefundForBooking` treat follow-ups.
// =============================================================================

/**
 * Resolve a dispute on a booking's consultation (or follow-up) proposal.
 * Mirrors `LegalEngagementEscrow.resolveDispute` — the chain layer enforces
 * `OnlyOperator`, `InvalidProposalState` (proposal must be `DISPUTED`), and
 * `InvalidSplit` (the two amounts must sum to the parked total).
 *
 * On a proposal[0] resolve (the consultation), the booking shell is flipped to
 * COMPLETED. On follow-up resolves we leave the booking row alone.
 */
export async function resolveDisputeForBooking(args: {
  booking: { id: string; engagementId: number | null; proposalIndex: number };
  proposalIndex: number;
  toLawyerWei: bigint | string;
  toClientWei: bigint | string;
  fromAddress: string;
}): Promise<{ txHash: string }> {
  const { booking, proposalIndex, toLawyerWei, toClientWei, fromAddress } = args;
  if (booking.engagementId == null) {
    throw new Error("Booking has no engagementId — cannot resolve dispute on chain.");
  }
  const result = await resolveDispute({
    engagementId: booking.engagementId,
    proposalIndex,
    toLawyerWei,
    toClientWei,
    from: fromAddress,
  });
  // Only flip the booking shell when the resolved proposal IS the consultation
  // (proposal[0]). Follow-up resolves are proposal-scoped and don't bubble up
  // to the booking row.
  if (proposalIndex === booking.proposalIndex) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "COMPLETED" },
    });
  }
  return result;
}

/**
 * F7: arbitrary-proposal resolve — addressed by (engagementId, proposalIndex)
 * without touching any Booking shell. Used by the operator routes when the
 * disputed proposal is a follow-up (proposalIndex>0) that has no 1:1 booking.
 */
export async function resolveDisputeForProposal(args: {
  engagementId: number;
  proposalIndex: number;
  toLawyerWei: bigint | string;
  toClientWei: bigint | string;
  fromAddress: string;
}): Promise<{ txHash: string }> {
  return resolveDispute({
    engagementId: args.engagementId,
    proposalIndex: args.proposalIndex,
    toLawyerWei: args.toLawyerWei,
    toClientWei: args.toClientWei,
    from: args.fromAddress,
  });
}
