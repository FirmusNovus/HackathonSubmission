/**
 * Escrow ABI fragments + shared helpers for the milestone-action routes
 * around the V2 escrow contract (2026-05-07 redesign).
 *
 * V2 vs V1: there is NO `proposeMilestone` (off-chain signed offer) and
 * NO unilateral `refundUndeliveredMilestone` (replaced by EIP-712 mutual
 * sigs). `fundMilestone` is now atomic create+fund, taking the agreed
 * amount directly. Anchoring is no longer paired with every state-change
 * tx — the only callers that emit a `TranscriptAnchored` log are
 * `closeEngagement`, `disputeMilestone`, and `escalateMilestone`, all of
 * which take the root inline as a parameter. Callers therefore receive a
 * single calldata payload, not the V1 `{primary, anchor}` pair.
 */
import { type Hex } from "viem";

export const ESCROW_ABI = [
  {
    type: "function",
    name: "fundMilestone",
    stateMutability: "payable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "milestoneIndex", type: "uint256" }],
  },
  {
    type: "function",
    name: "markDelivered",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mutualRefundMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "clientSignature", type: "bytes" },
      { name: "lawyerSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "disputeMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "transcriptRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "escalateMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "transcriptRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "amountToLawyer", type: "uint256" },
      { name: "amountToClient", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "anchorTranscript",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "newRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closeEngagement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "engagementId", type: "uint256" },
      { name: "finalTranscriptRoot", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export interface CalldataPayload {
  contract_address: `0x${string}`;
  function_name: string;
  abi: typeof ESCROW_ABI;
  args: readonly unknown[];
  value_wei?: string;
}

/**
 * V2 has no follow-up anchor tx. Callers return a single CalldataPayload.
 * The `value_wei` field is set only for `fundMilestone`. For state-change
 * txs that need a transcript root (`disputeMilestone`, `escalateMilestone`,
 * `closeEngagement`), the route reads the current off-chain root and
 * embeds it in `args` directly.
 */
export type EscrowCalldata = CalldataPayload;

/**
 * Reads the latest off-chain transcript root for an engagement so callers
 * that anchor inline (close, dispute, escalate) can include it in their
 * args without recomputing.
 */
export function readCurrentTranscriptRoot(
  db: import("better-sqlite3").Database,
  engagementId: number
): Hex {
  const row = db
    .prepare(
      `SELECT current_transcript_root FROM engagement_off_chain WHERE engagement_id = ?`
    )
    .get(engagementId) as { current_transcript_root: string | null } | undefined;
  // Default to a 32-byte zero — the contract accepts it, and it's the same
  // bottom-of-chain value the contract starts an engagement with.
  return ((row?.current_transcript_root ?? "0x" + "0".repeat(64)) as Hex);
}
