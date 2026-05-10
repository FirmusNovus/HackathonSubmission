"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, ShieldCheck, X } from "lucide-react";
import { useAccount, useWriteContract, useSwitchChain, useChainId } from "wagmi";
import type { Address, Hex } from "viem";
import { BookingStatus } from "@/lib/db/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatETH, truncateAddress } from "@/lib/utils/format";
import { orderPhase } from "@/lib/utils/order-phase";
import { useRealtimeBooking } from "@/lib/hooks/use-realtime-booking";
import { RefundActions } from "@/components/firmus/refund-actions";
import { DisputeButton } from "@/components/firmus/dispute-button";
import { DisputeArchiveButton } from "@/components/firmus/dispute-archive-button";
import {
  ESCROW_ABI,
  ZERO_BYTES32,
  bookingOpenNullifier,
  matterRefFromBookingId,
} from "@/lib/web3/escrow";

type Status = (typeof BookingStatus)[keyof typeof BookingStatus];

export interface OrderActionPanelProps {
  bookingId: string;
  lawyerName: string;
  totalEUR: number;
  platformFeeEUR: number;
  status: Status;
  clientAcceptedAt: string | null;
  lawyerAcceptedAt: string | null;
  escrowTxHash: string | null;
  escrowReleaseHash: string | null;
  engagementIdOnChain: number | null;
  // Phase 9 refund state — server-rendered initial values; SSE pushes live
  // updates after the first event.
  clientRefundSigned?: boolean;
  lawyerRefundSigned?: boolean;
  escrowRefundHash?: string | null;
  refundProposedBy?: "CLIENT" | "LAWYER" | null;
  // Phase 6 funding props — passed from server components so the client
  // doesn't need access to deployed-addresses.json or the lawyer's wallet
  // beyond what the user is already authorized to see.
  lawyerWalletAddress: Address;
  escrowAddress: Address;
  expectedChainId: number;
  // Dispute (Phase 11) — when status == DISPUTED the panel shows the
  // archive submission button, which needs the conversation id (for
  // fetching messages) and the counterparty's user id (for fetching
  // their pubkey, used to decrypt self-sent messages).
  conversationId?: string | null;
  counterpartyUserId?: string;
  selfArchiveSubmitted?: boolean;
  // Phase 11 — populated once an arbiter has settled the dispute on chain.
  disputeResolveTxHash?: string | null;
  disputeAmountToLawyer?: number | null;
  disputeAmountToClient?: number | null;
  // "client" view shows "→ you" copy on the client side; "lawyer" flips it.
  // Defaults to "client" since OrderActionPanel was historically client-only.
  viewer?: "client" | "lawyer";
}

export function OrderActionPanel(props: OrderActionPanelProps) {
  // Live booking state from /api/bookings/[id]/events. Pre-Phase-9, the
  // server-rendered props are the initial value; SSE pushes overwrite it as
  // the lawyer accepts, the client funds, etc. — so neither party can land
  // on a stale UI that lets them double-fund or claim "in escrow" without
  // the chain having confirmed.
  const live = useRealtimeBooking(props.bookingId, {
    status: props.status,
    clientAcceptedAt: props.clientAcceptedAt,
    lawyerAcceptedAt: props.lawyerAcceptedAt,
    engagementIdOnChain: props.engagementIdOnChain,
    escrowReleaseHash: props.escrowReleaseHash,
    escrowTxHash: props.escrowTxHash,
    clientRefundSigned: props.clientRefundSigned,
    lawyerRefundSigned: props.lawyerRefundSigned,
    escrowRefundHash: props.escrowRefundHash,
    refundProposedBy: props.refundProposedBy,
    disputeResolveTxHash: props.disputeResolveTxHash,
    disputeAmountToLawyer: props.disputeAmountToLawyer,
    disputeAmountToClient: props.disputeAmountToClient,
  });
  const phase = orderPhase({
    status: live.status as Status,
    clientAcceptedAt: live.clientAcceptedAt,
    lawyerAcceptedAt: live.lawyerAcceptedAt,
    totalEUR: props.totalEUR,
    escrowReleaseHash: live.escrowReleaseHash,
    engagementIdOnChain: live.engagementIdOnChain,
    disputeResolveTxHash: live.disputeResolveTxHash,
  });
  // Phase 6 onward: only the lawyer-bound consultationFee is funded into
  // escrow. The platformFee stays a display-only line item until the
  // contract supports an on-chain fee split.
  const grand = props.totalEUR;
  // Merged view — sub-components read everything from this so a stale prop
  // can't sneak past the live SSE state (the bug that let the client double-
  // fund before the page caught up).
  const merged: OrderActionPanelProps = {
    ...props,
    status: live.status as Status,
    clientAcceptedAt: live.clientAcceptedAt,
    lawyerAcceptedAt: live.lawyerAcceptedAt,
    escrowTxHash: live.escrowTxHash,
    escrowReleaseHash: live.escrowReleaseHash,
    engagementIdOnChain: live.engagementIdOnChain,
    clientRefundSigned: live.clientRefundSigned,
    lawyerRefundSigned: live.lawyerRefundSigned,
    escrowRefundHash: live.escrowRefundHash,
    refundProposedBy: live.refundProposedBy,
    disputeResolveTxHash: live.disputeResolveTxHash,
    disputeAmountToLawyer: live.disputeAmountToLawyer,
    disputeAmountToClient: live.disputeAmountToClient,
  };

  // Refunded → terminal state takes precedence over the phase enum.
  const refunded = Boolean(live.escrowRefundHash);

  return (
    <section
      data-testid="order-action-panel"
      data-phase={phase}
      className="rounded-2xl border-2 border-teal-100 bg-teal-50/50 p-6"
    >
      {refunded ? (
        <Banner
          tone="neutral"
          icon={<X className="h-4 w-4 text-slate-500" aria-hidden />}
          title={`Refunded — ${formatETH(grand)} returned to you on chain.`}
          body={
            live.escrowRefundHash ? (
              <>
                Refund tx: <code className="font-mono text-[12px] text-navy-900">{truncateAddress(live.escrowRefundHash)}</code>
              </>
            ) : null
          }
        />
      ) : (
        <>
          {phase === "awaiting-client" && <AwaitingClient {...merged} grand={grand} />}
          {phase === "awaiting-lawyer" && (
            <Banner
              tone="amber"
              icon={<Lock className="h-4 w-4 text-amber-600" aria-hidden />}
              title="Awaiting your lawyer's counter-signature."
              body="You've signed this order. Funds move into smart-contract escrow once the lawyer also signs."
            />
          )}
          {phase === "awaiting-funding" && <AwaitingFunding {...merged} grand={grand} />}
          {phase === "in-escrow" && <InEscrow {...merged} grand={grand} />}
          {phase === "released" && (
            <Banner
              tone="success"
              icon={<Check className="h-4 w-4 text-[#1A8A5C]" aria-hidden />}
              title={`Released — ${formatETH(grand)} paid to ${merged.lawyerName}.`}
              body={
                merged.escrowReleaseHash ? (
                  <>
                    Release tx: <code className="font-mono text-[12px] text-navy-900">{truncateAddress(merged.escrowReleaseHash)}</code>
                  </>
                ) : null
              }
            />
          )}
          {phase === "declined" && (
            <Banner
              tone="neutral"
              icon={<X className="h-4 w-4 text-slate-500" aria-hidden />}
              title="Order declined."
              body="No funds moved. Message the lawyer if you want a revised order."
            />
          )}
          {phase === "cancelled" && (
            <Banner tone="neutral" icon={<X className="h-4 w-4 text-slate-500" aria-hidden />} title="Booking cancelled." />
          )}
          {phase === "disputed" && (
            <div className="-m-1 flex items-start gap-3 rounded-xl border-red-100 bg-red-50/50 p-4">
              <span className="mt-0.5">
                <X className="h-4 w-4 text-red-500" aria-hidden />
              </span>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-navy-900">Dispute open.</div>
                <div className="mt-1 text-[13px] leading-relaxed text-slate-700">
                  Funds stay locked until the arbiter resolves the split. Submit your encrypted account of
                  the conversation so the arbiter can review it without needing your private key.
                </div>
                {props.conversationId && props.counterpartyUserId && (
                  <div className="mt-3">
                    <DisputeArchiveButton
                      kind="booking"
                      id={props.bookingId}
                      conversationId={props.conversationId}
                      counterpartyUserId={props.counterpartyUserId}
                      alreadySubmitted={Boolean(props.selfArchiveSubmitted)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {phase === "free" && (
            <Banner
              tone="success"
              icon={<Check className="h-4 w-4 text-[#1A8A5C]" aria-hidden />}
              title="Free consultation — no escrow."
            />
          )}
          {phase === "resolved" && (
            <Banner
              tone="neutral"
              icon={<Check className="h-4 w-4 text-slate-500" aria-hidden />}
              title={(() => {
                const lawyerSlice = merged.disputeAmountToLawyer ?? 0;
                const clientSlice = merged.disputeAmountToClient ?? 0;
                const yours = (props.viewer ?? "client") === "lawyer" ? lawyerSlice : clientSlice;
                const theirs = (props.viewer ?? "client") === "lawyer" ? clientSlice : lawyerSlice;
                return `Dispute resolved — ${formatETH(yours)} to you, ${formatETH(theirs)} to ${merged.lawyerName}.`;
              })()}
              body={
                merged.disputeResolveTxHash ? (
                  <>
                    Resolution tx:{" "}
                    <code className="font-mono text-[12px] text-navy-900">
                      {truncateAddress(merged.disputeResolveTxHash)}
                    </code>
                  </>
                ) : null
              }
            />
          )}
        </>
      )}
    </section>
  );
}

function AwaitingClient({
  bookingId,
  grand,
  lawyerName,
  lawyerWalletAddress,
  escrowAddress,
  expectedChainId,
}: OrderActionPanelProps & { grand: number }) {
  return (
    <>
      <h3 className="font-display text-xl text-navy-900">Approve & fund escrow.</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-slate-700">
        {lawyerName} has signed this order. Approving moves{" "}
        <strong className="text-navy-900">{formatETH(grand)}</strong> into smart-contract escrow.
        Funds only release to {lawyerName} after you confirm the work is done.
      </p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <ApproveAndFundDialog
          bookingId={bookingId}
          grand={grand}
          lawyerName={lawyerName}
          lawyerWalletAddress={lawyerWalletAddress}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
          mustSignFirst={true}
        />
        <DeclineDialog bookingId={bookingId} />
      </div>
    </>
  );
}

function AwaitingFunding({
  bookingId,
  grand,
  lawyerName,
  lawyerWalletAddress,
  escrowAddress,
  expectedChainId,
}: OrderActionPanelProps & { grand: number }) {
  return (
    <>
      <h3 className="font-display text-xl text-navy-900">Fund escrow to start the engagement.</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-slate-700">
        Both you and {lawyerName} have signed this order. The last step is to move{" "}
        <strong className="text-navy-900">{formatETH(grand)}</strong> into the smart-contract escrow from
        your wallet. The funds stay locked until you confirm the work is done.
      </p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <ApproveAndFundDialog
          bookingId={bookingId}
          grand={grand}
          lawyerName={lawyerName}
          lawyerWalletAddress={lawyerWalletAddress}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
          mustSignFirst={false}
        />
      </div>
    </>
  );
}

function InEscrow({
  bookingId,
  grand,
  lawyerName,
  escrowTxHash,
  engagementIdOnChain,
  escrowAddress,
  expectedChainId,
  clientRefundSigned,
  lawyerRefundSigned,
  refundProposedBy,
}: OrderActionPanelProps & { grand: number }) {
  return (
    <>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-white-0 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-teal-700">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Funds in escrow
      </div>
      <h3 className="font-display mt-2 text-xl text-navy-900">Release funds when the work is done.</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-slate-700">
        <strong className="text-navy-900">{formatETH(grand)}</strong> is held in escrow. Releasing sends it
        to {lawyerName} on chain — your wallet signs the release. If the engagement falls through instead,
        either side can propose a mutual refund.
      </p>
      {escrowTxHash && (
        <p className="mt-2 text-[12px] text-slate-500">
          Escrow tx:{" "}
          <code className="font-mono text-navy-900">{truncateAddress(escrowTxHash)}</code>
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <ReleaseDialog
          bookingId={bookingId}
          amount={grand}
          lawyerName={lawyerName}
          engagementIdOnChain={engagementIdOnChain}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
        />
        {engagementIdOnChain !== null && (
          <DisputeButton
            kind="booking"
            id={bookingId}
            engagementIdOnChain={engagementIdOnChain}
            milestoneIndex={0}
            escrowAddress={escrowAddress}
            expectedChainId={expectedChainId}
            counterpartyName={lawyerName}
            perspective="client"
          />
        )}
        {engagementIdOnChain !== null && (
          <RefundActions
            kind="booking"
            id={bookingId}
            engagementIdOnChain={engagementIdOnChain}
            milestoneIndex={0}
            perspective="client"
            selfSigned={Boolean(clientRefundSigned)}
            otherSigned={Boolean(lawyerRefundSigned)}
            proposedBy={refundProposedBy ?? null}
            refunded={false}
            counterpartyName={lawyerName}
            escrowAddress={escrowAddress}
            expectedChainId={expectedChainId}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialogs
// ---------------------------------------------------------------------------

interface ApproveAndFundDialogProps {
  bookingId: string;
  grand: number;
  lawyerName: string;
  lawyerWalletAddress: Address;
  escrowAddress: Address;
  expectedChainId: number;
  /**
   * True when the user hasn't recorded clientAcceptedAt yet (lawyer-initiated
   * order, "awaiting-client" phase). The dialog POSTs /sign before the
   * on-chain tx. False for the standalone-funding path ("awaiting-funding"
   * phase) where the signature was recorded in an earlier session.
   */
  mustSignFirst: boolean;
}

function ApproveAndFundDialog({
  bookingId,
  grand,
  lawyerName,
  lawyerWalletAddress,
  escrowAddress,
  expectedChainId,
  mustSignFirst,
}: ApproveAndFundDialogProps) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "signing" | "wallet" | "confirming" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!connectedAddress) {
      setError("Connect your wallet to fund the escrow.");
      return;
    }
    try {
      if (mustSignFirst) {
        setStep("signing");
        const sig = await fetch(`/api/bookings/${bookingId}/sign`, { method: "POST" });
        if (!sig.ok) {
          const data = await sig.json().catch(() => ({}));
          throw new Error(data?.error ?? "Could not record your signature.");
        }
      }

      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }

      setStep("wallet");
      // parseEther equivalent for a JS number — convert to a fixed-point string
      // first to avoid float drift, then to wei. Mirrors how the server-side
      // /funded endpoint computes the expected amount.
      const amountWei = ethToWei(grand);
      const txHash: Hex = await writeContractAsync({
        chainId: expectedChainId,
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: "openEngagementAndFundFirstMilestone",
        args: [
          lawyerWalletAddress,
          matterRefFromBookingId(bookingId),
          amountWei,
          "0x",
          bookingOpenNullifier(bookingId),
          ZERO_BYTES32,
        ],
        value: amountWei,
      });

      setStep("verifying");
      const fin = await fetch(`/api/bookings/${bookingId}/funded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!fin.ok) {
        const data = await fin.json().catch(() => ({}));
        throw new Error(data?.error ?? "Server could not verify the funding tx.");
      }

      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  const busy = step !== "idle";
  const buttonLabel = (() => {
    switch (step) {
      case "signing": return "Recording signature…";
      case "wallet": return "Confirm in wallet…";
      case "confirming": return "Submitting tx…";
      case "verifying": return "Verifying receipt…";
      default: return mustSignFirst ? `Approve & fund ${formatETH(grand)}` : `Fund ${formatETH(grand)}`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button
          variant="primary"
          data-testid={mustSignFirst ? "approve-order" : "fund-escrow"}
          disabled={!connectedAddress}
        >
          <Check className="h-4 w-4" aria-hidden />{" "}
          {mustSignFirst ? "Approve & fund escrow" : "Fund escrow"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{mustSignFirst ? "Approve & fund escrow?" : "Fund escrow?"}</DialogTitle>
        <DialogDescription>
          You're about to move <strong className="text-navy-900">{formatETH(grand)}</strong> into the
          smart-contract escrow. {lawyerName} cannot withdraw these funds — they're released only when
          you confirm the work is done. Once the tx confirms on chain, this is final.
        </DialogDescription>
        {!connectedAddress && (
          <p className="mt-3 text-[13px] text-amber-700">
            Wallet not connected — connect from the top bar before continuing.
          </p>
        )}
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="primary">
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {buttonLabel}
              </>
            ) : (
              <>{buttonLabel}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/decline`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not decline order.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" data-testid="decline-order">
          <X className="h-4 w-4" aria-hidden /> Decline
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Decline this order?</DialogTitle>
        <DialogDescription>
          The lawyer will be notified that you declined. No funds move and the order is closed. Message the
          lawyer separately if you want a revised order.
        </DialogDescription>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Keep open
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="danger">
            {busy ? "Declining…" : "Decline order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ReleaseDialogProps {
  bookingId: string;
  amount: number;
  lawyerName: string;
  engagementIdOnChain: number | null;
  escrowAddress: Address;
  expectedChainId: number;
}

function ReleaseDialog({
  bookingId,
  amount,
  lawyerName,
  engagementIdOnChain,
  escrowAddress,
  expectedChainId,
}: ReleaseDialogProps) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "wallet" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!connectedAddress) {
      setError("Connect your wallet to release the escrow.");
      return;
    }
    if (engagementIdOnChain === null || engagementIdOnChain === undefined) {
      setError("Booking has no on-chain engagement to release.");
      return;
    }
    setError(null);
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }
      setStep("wallet");
      const txHash: Hex = await writeContractAsync({
        chainId: expectedChainId,
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: "releaseMilestone",
        args: [BigInt(engagementIdOnChain), 0n],
      });

      setStep("verifying");
      const fin = await fetch(`/api/bookings/${bookingId}/released`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!fin.ok) {
        const data = await fin.json().catch(() => ({}));
        throw new Error(data?.error ?? "Server could not verify the release tx.");
      }

      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  const busy = step !== "idle";
  const buttonLabel = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "verifying": return "Verifying receipt…";
      default: return `Release ${formatETH(amount)}`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="primary" data-testid="release-funds" disabled={!connectedAddress}>
          <Check className="h-4 w-4" aria-hidden /> Release funds
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Release {formatETH(amount)} to {lawyerName}?</DialogTitle>
        <DialogDescription>
          Releasing sends the escrowed amount to {lawyerName} on-chain. Your wallet signs the release. This
          action is final — open a dispute instead if anything's wrong with the work.
        </DialogDescription>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Not yet
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="primary">
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {buttonLabel}
              </>
            ) : (
              <>{buttonLabel}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Banner — terminal / informational states
// ---------------------------------------------------------------------------

function Banner({
  tone,
  icon,
  title,
  body,
}: {
  tone: "amber" | "success" | "neutral" | "error";
  icon: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-100 bg-amber-50/50"
      : tone === "success"
        ? "border-green-100 bg-green-50/50"
        : tone === "error"
          ? "border-red-100 bg-red-50/50"
          : "border-slate-100 bg-white-50";
  return (
    <div className={`-m-1 flex items-start gap-3 rounded-xl ${cls} p-4`}>
      <span className="mt-0.5">{icon}</span>
      <div>
        <div className="text-[14px] font-semibold text-navy-900">{title}</div>
        {body && <div className="mt-1 text-[13px] leading-relaxed text-slate-700">{body}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ETH amount expressed as a JS number to wei. Mirrors the
 * server's `parseEther(grandEth.toFixed(18))` — going through a fixed-point
 * string avoids float drift in the last digits.
 */
function ethToWei(eth: number): bigint {
  const fixed = eth.toFixed(18);
  const [whole, frac = ""] = fixed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
}
