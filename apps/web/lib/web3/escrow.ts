// Real LegalEngagementEscrow ABI + cross-runtime helpers.
//
// Phase 6 made the funding tx client-signed (msg.sender == client gate in the
// contract). The server no longer creates escrows — it only verifies the
// receipt of the client's tx via /api/bookings/[id]/funded. The release path
// (Phase 7) is also client-signed, so the server's only on-chain action in
// the escrow flow is reading receipts and parsing events.
//
// This module is import-safe from both Node and Edge/browser runtimes — it
// pulls only viem's ABI utilities and does no fs/RPC.

import {
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToBytes,
  type Address,
  type Hex,
  type Log,
} from "viem";

export const ESCROW_ABI = parseAbi([
  "function openEngagementAndFundFirstMilestone(address lawyer, bytes32 matterRef, uint256 amount, bytes zkConflictProof, bytes32 zkNullifier, bytes32 initialTranscriptRoot) payable returns (uint256 engagementId)",
  "function fundMilestone(uint256 engagementId, uint256 amount) payable returns (uint256 milestoneIndex)",
  "function releaseMilestone(uint256 engagementId, uint256 milestoneIndex)",
  "function mutualRefundMilestone(uint256 engagementId, uint256 milestoneIndex, bytes clientSignature, bytes lawyerSignature)",
  "function disputeMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)",
  "function escalateMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)",
  "function resolveDispute(uint256 engagementId, uint256 milestoneIndex, uint256 amountToLawyer, uint256 amountToClient)",
  "function getEngagement(uint256 engagementId) view returns ((address client, address lawyer, bytes32 matterRef, uint8 state, bytes32 transcriptRoot, uint256 milestoneCount))",
  "function getMilestone(uint256 engagementId, uint256 milestoneIndex) view returns ((uint256 amount, uint8 state, uint64 deliveredAt, uint256 amountToLawyer, uint256 amountToClient))",
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)",
  "event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
  "event MilestoneMutuallyRefunded(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
  "event MilestoneDisputed(uint256 indexed engagementId, uint256 indexed milestoneIndex, address by)",
  "event MilestoneResolved(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 toLawyer, uint256 toClient)",
]);

export const ZERO_BYTES32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Stable mapping from a booking's DB id (a cuid string) to a bytes32 matterRef
 * the contract stores. The platform uses this to correlate chain engagements
 * back to bookings without a separate index table — given a bookingId, anyone
 * can derive the matterRef and look up the engagement.
 */
export function matterRefFromBookingId(bookingId: string): Hex {
  return keccak256(stringToBytes(bookingId));
}

/**
 * Generate a fresh 32-byte nullifier for the StubZKConflictVerifier. Real ZK
 * proofs would use a Poseidon-hash-derived nullifier tied to the lawyer +
 * client identity; the stub just rejects double-spend, so any unique value
 * works. Browser-friendly: uses crypto.getRandomValues.
 */
export function randomNullifier(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/**
 * Booking-scoped nullifier — deterministic from the booking id. Using this
 * instead of `randomNullifier` makes the open-engagement tx safely
 * retryable on flaky networks, AND makes a second concurrent attempt revert
 * on chain (NullifierAlreadyUsed) instead of silently funding a second
 * engagement against the same matter. The keccak input is namespaced so
 * future flows (refund, dispute) can derive their own non-colliding
 * nullifiers from the same booking id.
 */
export function bookingOpenNullifier(bookingId: string): Hex {
  return keccak256(stringToBytes(`firmus:open-engagement:${bookingId}`));
}

export interface ParsedFundedReceipt {
  engagementId: bigint;
  client: Address;
  lawyer: Address;
  matterRef: Hex;
  amount: bigint;
}

export interface ParsedReleasedReceipt {
  engagementId: bigint;
  milestoneIndex: bigint;
}

export interface ParsedFundMilestoneReceipt {
  engagementId: bigint;
  milestoneIndex: bigint;
  amount: bigint;
}

export interface ParsedRefundedReceipt {
  engagementId: bigint;
  milestoneIndex: bigint;
}

export interface ParsedDisputedReceipt {
  engagementId: bigint;
  milestoneIndex: bigint;
  by: Address;
}

export interface ParsedResolvedReceipt {
  engagementId: bigint;
  milestoneIndex: bigint;
  toLawyer: bigint;
  toClient: bigint;
}

/**
 * Pull the EngagementOpened + MilestoneFunded events out of a confirmed
 * receipt. Throws if either is missing or if the two disagree on
 * engagementId. Used by /api/bookings/[id]/funded to validate that the tx
 * the client claims to have submitted is in fact a funding tx for the right
 * engagement.
 */
export function parseFundedReceipt(logs: Log[]): ParsedFundedReceipt {
  const opened = parseEventLogs({ abi: ESCROW_ABI, eventName: "EngagementOpened", logs });
  if (opened.length === 0) {
    throw new Error("no EngagementOpened event in receipt");
  }
  const funded = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneFunded", logs });
  if (funded.length === 0) {
    throw new Error("no MilestoneFunded event in receipt");
  }
  const o = opened[0].args;
  const f = funded[0].args;
  if (o.engagementId !== f.engagementId) {
    throw new Error("EngagementOpened/MilestoneFunded engagementId mismatch");
  }
  return {
    engagementId: o.engagementId,
    client: o.client,
    lawyer: o.lawyer,
    matterRef: o.matterRef,
    amount: f.amount,
  };
}

/**
 * Pull the MilestoneReleased event out of a confirmed receipt. Used by
 * /api/bookings/[id]/released and /api/orders/[id]/released to validate the
 * client's release tx.
 */
export function parseReleasedReceipt(logs: Log[]): ParsedReleasedReceipt {
  const released = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneReleased", logs });
  if (released.length === 0) {
    throw new Error("no MilestoneReleased event in receipt");
  }
  const r = released[0].args;
  return { engagementId: r.engagementId, milestoneIndex: r.milestoneIndex };
}

/**
 * Pull the MilestoneFunded event from a `fundMilestone` (Phase 8 follow-up)
 * tx receipt. Distinct from `parseFundedReceipt` which expects the
 * EngagementOpened pair from `openEngagementAndFundFirstMilestone`.
 */
export function parseFundMilestoneReceipt(logs: Log[]): ParsedFundMilestoneReceipt {
  const funded = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneFunded", logs });
  if (funded.length === 0) {
    throw new Error("no MilestoneFunded event in receipt");
  }
  const f = funded[0].args;
  return { engagementId: f.engagementId, milestoneIndex: f.milestoneIndex, amount: f.amount };
}

/**
 * Pull the MilestoneMutuallyRefunded event from a `mutualRefundMilestone`
 * tx receipt. Used by /api/{bookings,orders}/[id]/refunded.
 */
export function parseRefundedReceipt(logs: Log[]): ParsedRefundedReceipt {
  const refunded = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneMutuallyRefunded", logs });
  if (refunded.length === 0) {
    throw new Error("no MilestoneMutuallyRefunded event in receipt");
  }
  const r = refunded[0].args;
  return { engagementId: r.engagementId, milestoneIndex: r.milestoneIndex };
}

export function parseDisputedReceipt(logs: Log[]): ParsedDisputedReceipt {
  const disputed = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneDisputed", logs });
  if (disputed.length === 0) {
    throw new Error("no MilestoneDisputed event in receipt");
  }
  const d = disputed[0].args;
  return { engagementId: d.engagementId, milestoneIndex: d.milestoneIndex, by: d.by };
}

export function parseResolvedReceipt(logs: Log[]): ParsedResolvedReceipt {
  const resolved = parseEventLogs({ abi: ESCROW_ABI, eventName: "MilestoneResolved", logs });
  if (resolved.length === 0) {
    throw new Error("no MilestoneResolved event in receipt");
  }
  const r = resolved[0].args;
  return {
    engagementId: r.engagementId,
    milestoneIndex: r.milestoneIndex,
    toLawyer: r.toLawyer,
    toClient: r.toClient,
  };
}
