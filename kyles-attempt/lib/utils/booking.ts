// `status` is the raw `Booking.status` string off Prisma (SQLite has no
// enums), so these helpers accept `string` and narrow internally via the
// known status values.

import type { ProposalState } from "@/lib/chain/escrow";

// Open the consultation room from this many minutes BEFORE the scheduled
// start time, and keep it open this many minutes AFTER the scheduled end.
const PRE_OPEN_MIN = 30;
const POST_GRACE_MIN = 30;

/**
 * Whether the consultation room should be reachable for a given booking right
 * now. Gates the "Join consultation" button.
 *
 * - REQUESTED bookings are never joinable (the lawyer hasn't accepted yet).
 * - ACCEPTED / IN_PROGRESS / DELIVERED are joinable only inside a +/- window
 *   around the scheduled time. DELIVERED bookings remain joinable so the
 *   client can finish reviewing before releasing escrow.
 * - Terminal states (COMPLETED / DECLINED / CANCELLED / DISPUTED) are never
 *   joinable.
 */
export function isJoinableNow(
  status: string,
  scheduledAt: Date,
  durationMinutes: number,
  now: Date = new Date(),
): boolean {
  if (status !== "ACCEPTED" && status !== "IN_PROGRESS" && status !== "DELIVERED") return false;
  const start = scheduledAt.getTime() - PRE_OPEN_MIN * 60_000;
  const end = scheduledAt.getTime() + (durationMinutes + POST_GRACE_MIN) * 60_000;
  const t = now.getTime();
  return t >= start && t <= end;
}

/**
 * Human-readable explanation of why a booking can or can't be joined right now,
 * suitable for a small status caption next to the button.
 */
export function joinabilityReason(
  status: string,
  scheduledAt: Date,
  now: Date = new Date(),
): string {
  switch (status) {
    case "REQUESTED":
      return "Waiting for the lawyer to accept";
    case "DECLINED":
      return "Declined by the lawyer";
    case "CANCELLED":
      return "Cancelled";
    case "DISPUTED":
      return "Under dispute resolution";
    case "COMPLETED":
      return "Consultation complete";
    case "DELIVERED":
      return "Lawyer marked delivered — release escrow to complete";
    case "ACCEPTED":
    case "IN_PROGRESS": {
      const diffMin = Math.round((scheduledAt.getTime() - now.getTime()) / 60_000);
      if (diffMin > PRE_OPEN_MIN) {
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        if (hours > 0) return `Opens ${PRE_OPEN_MIN} min before the consultation · in ${hours}h ${mins}m`;
        return `Opens ${PRE_OPEN_MIN} min before the consultation · in ${diffMin}m`;
      }
      if (diffMin >= -POST_GRACE_MIN) return "Open now";
      return "Window closed";
    }
    default:
      return "";
  }
}

/**
 * Map an on-chain `Proposal.state` (plus the off-chain accept signals) onto
 * the user-facing `BookingStatus`. F3 wires this so the UI can derive the
 * Booking status purely from chain state when both are present, keeping the
 * Booking row a faithful mirror of the engagement.
 *
 * Mapping (matches A's lifecycle, with the lawyer-accept off-chain layer):
 *   FUNDED, lawyerAccepted=null    → REQUESTED
 *   FUNDED, lawyerAccepted=set     → ACCEPTED
 *   DELIVERED                      → DELIVERED
 *   RELEASED                       → COMPLETED
 *   DISPUTED                       → DISPUTED
 *   RESOLVED                       → COMPLETED  (operator split paid out)
 *   REFUNDED                       → CANCELLED
 *   NONE                           → REQUESTED  (booking opened but no chain)
 */
export function bookingStatusFromProposal(
  proposalState: ProposalState | string,
  lawyerAccepted: Date | null | undefined,
  declined: boolean = false,
): "REQUESTED" | "ACCEPTED" | "DECLINED" | "DELIVERED" | "COMPLETED" | "DISPUTED" | "CANCELLED" {
  if (declined) return "DECLINED";
  switch (proposalState) {
    case "FUNDED":
      return lawyerAccepted ? "ACCEPTED" : "REQUESTED";
    case "DELIVERED":
      return "DELIVERED";
    case "RELEASED":
    case "RESOLVED":
      return "COMPLETED";
    case "DISPUTED":
      return "DISPUTED";
    case "REFUNDED":
      return "CANCELLED";
    case "NONE":
    default:
      return "REQUESTED";
  }
}
