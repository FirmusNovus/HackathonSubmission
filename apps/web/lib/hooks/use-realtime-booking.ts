"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Subscribe to /api/bookings/[id]/events. Returns the latest server-pushed
 * snapshot of the fields each consumer cares about, falling back to the
 * server-rendered `initial` value before the first SSE message arrives.
 *
 * Reconnects on socket close — Browsers' EventSource tries automatically,
 * but we also surface the connected state so consumers can disable destructive
 * actions while we're flying blind.
 */
export interface BookingRealtimeState {
  status: string;
  clientAcceptedAt: string | null;
  lawyerAcceptedAt: string | null;
  engagementIdOnChain: number | null;
  escrowReleaseHash: string | null;
  // Refund flags (Phase 9). Booleans only — actual sigs stay server-side.
  clientRefundSigned?: boolean;
  lawyerRefundSigned?: boolean;
  escrowRefundHash?: string | null;
  refundProposedBy?: "CLIENT" | "LAWYER" | null;
  // Dispute resolution (Phase 11). When `disputeResolveTxHash` is set, the
  // arbiter executed `resolveDispute(...)` on chain; status will be COMPLETED
  // but escrowReleaseHash stays null. Amounts are in ETH.
  disputeResolveTxHash?: string | null;
  disputeAmountToLawyer?: number | null;
  disputeAmountToClient?: number | null;
}

export function useRealtimeBooking<T extends BookingRealtimeState>(
  bookingId: string,
  initial: T,
): T {
  const [state, setState] = useState<T>(initial);
  // Keep latest initial in a ref so server-prop updates (e.g. router.refresh)
  // don't get clobbered by the SSE handler if it has yet to receive its
  // first message.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!bookingId) return;
    const es = new EventSource(`/api/bookings/${bookingId}/events`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Partial<BookingRealtimeState>;
        setState((prev) => ({ ...prev, ...data }));
        // Test hook: lets Playwright wait for SSE to actually be live before
        // it triggers state changes that need to round-trip through the
        // channel. Cheap and only inspected by tests; production users
        // never see this.
        if (typeof window !== "undefined") {
          const w = window as unknown as { __firmusSseBookingCount?: number };
          w.__firmusSseBookingCount = (w.__firmusSseBookingCount ?? 0) + 1;
        }
      } catch {
        // Malformed payload — ignore; the stream will recover next event.
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects with backoff; nothing to do here. Component
      // unmount triggers `es.close()` via the cleanup below.
    };
    return () => es.close();
  }, [bookingId]);

  return state;
}
