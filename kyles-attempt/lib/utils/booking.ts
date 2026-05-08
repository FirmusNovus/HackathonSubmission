import type { BookingStatus } from "@prisma/client";

// Open the consultation room from this many minutes BEFORE the scheduled
// start time, and keep it open this many minutes AFTER the scheduled end.
const PRE_OPEN_MIN = 30;
const POST_GRACE_MIN = 30;

/**
 * Whether the consultation room should be reachable for a given booking right
 * now. Gates the "Join consultation" button.
 *
 * - REQUESTED bookings are never joinable (the lawyer hasn't accepted yet).
 * - ACCEPTED / IN_PROGRESS are joinable only inside a +/- window around the
 *   scheduled time.
 * - Terminal states (COMPLETED / DECLINED / CANCELLED / DISPUTED) are never
 *   joinable.
 */
export function isJoinableNow(
  status: BookingStatus,
  scheduledAt: Date,
  durationMinutes: number,
  now: Date = new Date(),
): boolean {
  if (status !== "ACCEPTED" && status !== "IN_PROGRESS") return false;
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
  status: BookingStatus,
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
  }
}
