"use client";

import { useEffect, useRef, useState } from "react";

export interface OrderRealtimeState {
  status: string;
  milestoneIndex: number | null;
  escrowTxHash: string | null;
  escrowReleaseHash: string | null;
  amountETH: number;
  engagementIdOnChain: number;
  // Refund flags (Phase 9).
  clientRefundSigned?: boolean;
  lawyerRefundSigned?: boolean;
  escrowRefundHash?: string | null;
  refundProposedBy?: "CLIENT" | "LAWYER" | null;
  // Dispute resolution (Phase 11). See useRealtimeBooking for the same fields.
  disputeResolveTxHash?: string | null;
  disputeAmountToLawyer?: number | null;
  disputeAmountToClient?: number | null;
}

/**
 * Subscribe to /api/orders/[id]/events for follow-up Order state. Same
 * pattern as useRealtimeBooking — server pushes after every mutation.
 */
export function useRealtimeOrder<T extends OrderRealtimeState>(
  orderId: string,
  initial: T,
): T {
  const [state, setState] = useState<T>(initial);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!orderId) return;
    const es = new EventSource(`/api/orders/${orderId}/events`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Partial<OrderRealtimeState>;
        setState((prev) => ({ ...prev, ...data }));
        if (typeof window !== "undefined") {
          const w = window as unknown as { __firmusSseOrderCount?: number };
          w.__firmusSseOrderCount = (w.__firmusSseOrderCount ?? 0) + 1;
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [orderId]);

  return state;
}
