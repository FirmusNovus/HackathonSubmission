"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, Lock, ShieldCheck, X } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useSignTypedData } from "wagmi";
import type { Address } from "viem";
import { parseEther } from "viem";
import { Button } from "@/components/ui/button";
import { BookingStatus } from "@/lib/db/enums";
import { useRealtimeBooking } from "@/lib/hooks/use-realtime-booking";
import { RefundActions } from "@/components/firmus/refund-actions";
import { DisputeArchiveButton } from "@/components/firmus/dispute-archive-button";
import { DisputeButton } from "@/components/firmus/dispute-button";
import {
  BOOKING_ACCEPT_TYPES,
  buildBookingDomain,
  generateBookingNonce,
  type BookingAcceptPayload,
} from "@/lib/web3/booking-eip712";

interface BookingState {
  status: string;
  clientAcceptedAt: string | null;
  lawyerAcceptedAt: string | null;
  engagementIdOnChain: number | null;
  escrowReleaseHash: string | null;
  clientRefundSigned?: boolean;
  lawyerRefundSigned?: boolean;
  escrowRefundHash?: string | null;
  refundProposedBy?: "CLIENT" | "LAWYER" | null;
  disputeResolveTxHash?: string | null;
  disputeAmountToLawyer?: number | null;
  disputeAmountToClient?: number | null;
}

export function OrderActions({
  bookingId,
  initial,
  consultationFeeETH,
  scheduledAt,
  escrowAddress,
  expectedChainId,
  conversationId,
  counterpartyUserId,
  selfArchiveSubmitted,
}: {
  bookingId: string;
  initial: BookingState;
  consultationFeeETH: number;
  scheduledAt: string; // ISO
  escrowAddress: Address;
  expectedChainId: number;
  conversationId?: string | null;
  counterpartyUserId?: string;
  selfArchiveSubmitted?: boolean;
}) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live state from the SSE channel keyed on this booking. Falls back to the
  // server-rendered initial snapshot until the first event arrives.
  const live = useRealtimeBooking(bookingId, initial);

  const status = live.status;
  const clientSigned = Boolean(live.clientAcceptedAt);
  const lawyerSigned = Boolean(live.lawyerAcceptedAt);
  const funded = live.engagementIdOnChain !== null;
  const released = Boolean(live.escrowReleaseHash);

  const accept = async () => {
    if (!connectedAddress) {
      setError("Connect your wallet to sign the accept.");
      return;
    }
    setBusy("accept");
    setError(null);
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }
      const nonce = generateBookingNonce();
      const message: BookingAcceptPayload = {
        lawyer: connectedAddress,
        bookingId,
        consultationFeeWei: parseEther(consultationFeeETH.toFixed(18)),
        scheduledAtUnix: BigInt(Math.floor(new Date(scheduledAt).getTime() / 1000)),
        nonce,
      };
      const signature = await signTypedDataAsync({
        domain: buildBookingDomain({ chainId: expectedChainId, verifyingContract: escrowAddress }),
        types: BOOKING_ACCEPT_TYPES,
        primaryType: "BookingAccept",
        message,
      });
      const res = await fetch(`/api/bookings/${bookingId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, nonce }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `Accept failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/decline`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `Decline failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const refunded = Boolean(live.escrowRefundHash);
  if (refunded) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        <X className="h-3.5 w-3.5" aria-hidden /> Engagement refunded — funds returned to the client on chain.
      </p>
    );
  }

  if (status === BookingStatus.DECLINED) {
    return (
      <p className="mt-8 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        This order was declined — no funds moved.
      </p>
    );
  }

  if (live.disputeResolveTxHash) {
    const yours = live.disputeAmountToLawyer ?? 0;
    const theirs = live.disputeAmountToClient ?? 0;
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-slate-700">
        <Check className="h-3.5 w-3.5" aria-hidden /> Dispute resolved — {yours.toFixed(4)} ETH to you, {theirs.toFixed(4)} ETH to the client.
      </p>
    );
  }

  if (released || status === BookingStatus.COMPLETED) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-[#1A8A5C]">
        <Check className="h-3.5 w-3.5" aria-hidden /> Released — funds settled to your wallet.
      </p>
    );
  }

  if (status === BookingStatus.DISPUTED) {
    return (
      <div className="mt-8 border-t border-slate-100 pt-6">
        <p className="flex items-center gap-2 text-[13px] text-red-600">
          <X className="h-3.5 w-3.5" aria-hidden /> Dispute open — funds locked until the arbiter decides.
        </p>
        {conversationId && counterpartyUserId && (
          <div className="mt-3">
            <DisputeArchiveButton
              kind="booking"
              id={bookingId}
              conversationId={conversationId}
              counterpartyUserId={counterpartyUserId}
              alreadySubmitted={Boolean(selfArchiveSubmitted)}
            />
          </div>
        )}
      </div>
    );
  }

  // Both signed AND funded → in-escrow, awaiting client release. Lawyer
  // can also propose / co-sign a mutual refund here, or escalate to the
  // arbiter if the client isn't releasing or refunding.
  if (clientSigned && lawyerSigned && funded && live.engagementIdOnChain !== null) {
    return (
      <div className="mt-8 border-t border-slate-100 pt-6">
        <p className="flex items-center gap-2 text-[13px] text-teal-700">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Funds in escrow — awaiting the client's release after the consultation.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <DisputeButton
            kind="booking"
            id={bookingId}
            engagementIdOnChain={live.engagementIdOnChain}
            milestoneIndex={0}
            escrowAddress={escrowAddress}
            expectedChainId={expectedChainId}
            counterpartyName="the client"
            perspective="lawyer"
          />
          <RefundActions
            kind="booking"
            id={bookingId}
            engagementIdOnChain={live.engagementIdOnChain}
            milestoneIndex={0}
            perspective="lawyer"
            selfSigned={Boolean(live.lawyerRefundSigned)}
            otherSigned={Boolean(live.clientRefundSigned)}
            proposedBy={live.refundProposedBy ?? null}
            refunded={false}
            counterpartyName="the client"
            escrowAddress={escrowAddress}
            expectedChainId={expectedChainId}
          />
        </div>
      </div>
    );
  }

  // Both signed but not yet funded → awaiting client's on-chain funding tx.
  // This is the gap that previously fell through to the accept/decline buttons
  // again (lawyer would think their accept didn't take).
  if (clientSigned && lawyerSigned && !funded) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        <Lock className="h-3.5 w-3.5" aria-hidden /> You accepted this order. Waiting for the client to fund
        escrow from their wallet — they'll be prompted on their case page.
      </p>
    );
  }

  // Lawyer-initiated order waiting on the client.
  if (lawyerSigned && !clientSigned) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        <Calendar className="h-3.5 w-3.5" aria-hidden /> You signed this order. Waiting for the client to
        counter-sign and fund escrow from their wallet.
      </p>
    );
  }

  // Client-initiated, lawyer hasn't signed yet — accept or decline.
  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      {error && <p className="mb-3 text-right text-[13px] text-red-500">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={() => void decline()} disabled={!!busy}>
          <X className="h-4 w-4" aria-hidden /> {busy === "decline" ? "Declining…" : "Decline"}
        </Button>
        <Button variant="primary" onClick={() => void accept()} disabled={!!busy || !connectedAddress}>
          <Check className="h-4 w-4" aria-hidden />{" "}
          {busy === "accept" ? "Confirm in wallet…" : "Sign & accept"}
        </Button>
      </div>
    </div>
  );
}
