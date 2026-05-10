import { BookingStatus } from "@/lib/db/enums";

export type OrderPhase =
  | "awaiting-client"   // lawyer signed, client to approve / decline (also funds)
  | "awaiting-lawyer"   // client signed, lawyer to counter-sign
  | "awaiting-funding"  // both signed, client must submit on-chain funding tx
  | "in-escrow"         // both signed; client can release after work
  | "released"          // funds paid out
  | "resolved"          // dispute settled by arbiter; chain split executed
  | "declined"          // never funded
  | "cancelled"         // booked, never started
  | "disputed"          // raised dispute
  | "free";             // 0 ETH booking — no escrow flow at all

export interface PhaseInput {
  status: (typeof BookingStatus)[keyof typeof BookingStatus];
  clientAcceptedAt: string | null;
  lawyerAcceptedAt: string | null;
  totalEUR: number;
  escrowReleaseHash: string | null;
  // Phase 6 split: a booking with both signatures present but no chain
  // engagement is "awaiting-funding" — the client must submit the
  // `openEngagementAndFundFirstMilestone` tx from their wallet. Once it
  // confirms (/api/bookings/[id]/funded creates the Engagement row), the
  // booking advances to ACCEPTED + "in-escrow".
  engagementIdOnChain: number | null;
  // Phase 11 — when set, the arbiter resolved a dispute on chain and the
  // milestone funds were split. Status is COMPLETED but escrowReleaseHash
  // stays null because the chain tx is `resolveDispute`, not `release`.
  disputeResolveTxHash?: string | null;
}

export function orderPhase(p: PhaseInput): OrderPhase {
  if (p.disputeResolveTxHash) return "resolved";
  if (p.status === BookingStatus.DECLINED) return "declined";
  if (p.status === BookingStatus.CANCELLED) return "cancelled";
  if (p.status === BookingStatus.DISPUTED) return "disputed";
  const both = Boolean(p.clientAcceptedAt && p.lawyerAcceptedAt);
  if (p.status === BookingStatus.COMPLETED) return p.escrowReleaseHash ? "released" : "free";
  if (both && p.totalEUR <= 0) return "free";
  if (both && p.engagementIdOnChain === null) return "awaiting-funding";
  if (both) return "in-escrow";
  if (p.lawyerAcceptedAt && !p.clientAcceptedAt) return "awaiting-client";
  return "awaiting-lawyer";
}

export function orderPhaseLabel(
  phase: OrderPhase,
): { label: string; kind: "pending" | "info" | "success" | "neutral" | "error" } {
  switch (phase) {
    case "awaiting-client":  return { label: "Awaiting your approval", kind: "pending" };
    case "awaiting-lawyer":  return { label: "Awaiting lawyer", kind: "pending" };
    case "awaiting-funding": return { label: "Awaiting on-chain funding", kind: "pending" };
    case "in-escrow":        return { label: "Funds in escrow", kind: "info" };
    case "released":         return { label: "Released", kind: "success" };
    case "resolved":         return { label: "Dispute resolved", kind: "neutral" };
    case "declined":         return { label: "Declined", kind: "neutral" };
    case "cancelled":        return { label: "Cancelled", kind: "neutral" };
    case "disputed":         return { label: "Disputed", kind: "error" };
    case "free":             return { label: "Closed", kind: "success" };
  }
}
