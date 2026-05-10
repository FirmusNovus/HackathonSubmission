"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ESCROW_ABI } from "@/lib/web3/escrow";
import { formatETH } from "@/lib/utils/format";
import { useRealtimeOrder, type OrderRealtimeState } from "@/lib/hooks/use-realtime-order";
import { RefundActions } from "@/components/firmus/refund-actions";
import { DisputeButton } from "@/components/firmus/dispute-button";

/**
 * Client-side actions for a follow-up Order. Two flows:
 *
 *   • Fund (status === REQUESTED) — wagmi writeContract `fundMilestone`,
 *     then POST /api/orders/[id]/funded with the txHash.
 *   • Release (status === ACCEPTED) — wagmi writeContract `releaseMilestone`,
 *     then POST /api/orders/[id]/released.
 *
 * Both share the same chain-switch + verify pattern as OrderActionPanel.
 */

interface ActionsProps {
  orderId: string;
  engagementIdOnChain: number;
  status: string;
  amountETH: number;
  milestoneIndex: number | null;
  escrowAddress: Address;
  expectedChainId: number;
  /** Counterparty name for dialog copy. */
  counterpartyName: string;
  /** Render mode — slightly different copy for client vs lawyer side. */
  perspective: "client" | "lawyer";
}

export function OrderFollowUpActions({
  orderId,
  engagementIdOnChain,
  status,
  amountETH,
  milestoneIndex,
  escrowAddress,
  expectedChainId,
  counterpartyName,
  perspective,
}: ActionsProps) {
  // Live state from /api/orders/[id]/events. Falls back to the server-rendered
  // initial values until the first SSE message arrives. Same defense as the
  // booking case: prevents the client from double-funding because the page's
  // status prop hadn't caught up.
  const live = useRealtimeOrder<OrderRealtimeState>(orderId, {
    status,
    milestoneIndex,
    escrowTxHash: null,
    escrowReleaseHash: null,
    amountETH,
    engagementIdOnChain,
    clientRefundSigned: false,
    lawyerRefundSigned: false,
    escrowRefundHash: null,
    refundProposedBy: null,
  });

  // Refund (Phase 9). Available to either side once the order is funded
  // (status === ACCEPTED, milestoneIndex set) and not yet released or
  // refunded. Renders the same RefundActions flow as a booking.
  const refundEligible =
    live.status === "ACCEPTED" &&
    live.milestoneIndex !== null &&
    !live.escrowReleaseHash &&
    !live.escrowRefundHash;

  if (perspective === "lawyer") {
    if (live.status === "REQUESTED") {
      return <CancelButton orderId={orderId} />;
    }
    if (refundEligible) {
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <DisputeButton
            kind="order"
            id={orderId}
            engagementIdOnChain={live.engagementIdOnChain}
            milestoneIndex={live.milestoneIndex!}
            escrowAddress={escrowAddress}
            expectedChainId={expectedChainId}
            counterpartyName="the client"
            perspective="lawyer"
          />
          <RefundActions
            kind="order"
            id={orderId}
            engagementIdOnChain={live.engagementIdOnChain}
            milestoneIndex={live.milestoneIndex!}
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
      );
    }
    return null;
  }

  // Client perspective:
  if (live.status === "REQUESTED") {
    return (
      <div className="flex flex-wrap gap-2.5">
        <FundButton
          orderId={orderId}
          engagementIdOnChain={live.engagementIdOnChain}
          amountETH={live.amountETH}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
          counterpartyName={counterpartyName}
        />
        <DeclineButton orderId={orderId} />
      </div>
    );
  }
  if (refundEligible) {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <ReleaseButton
          orderId={orderId}
          engagementIdOnChain={live.engagementIdOnChain}
          milestoneIndex={live.milestoneIndex!}
          amountETH={live.amountETH}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
          counterpartyName={counterpartyName}
        />
        <DisputeButton
          kind="order"
          id={orderId}
          engagementIdOnChain={live.engagementIdOnChain}
          milestoneIndex={live.milestoneIndex!}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
          counterpartyName={counterpartyName}
          perspective="client"
        />
        <RefundActions
          kind="order"
          id={orderId}
          engagementIdOnChain={live.engagementIdOnChain}
          milestoneIndex={live.milestoneIndex!}
          perspective="client"
          selfSigned={Boolean(live.clientRefundSigned)}
          otherSigned={Boolean(live.lawyerRefundSigned)}
          proposedBy={live.refundProposedBy ?? null}
          refunded={false}
          counterpartyName={counterpartyName}
          escrowAddress={escrowAddress}
          expectedChainId={expectedChainId}
        />
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fund
// ---------------------------------------------------------------------------

function FundButton({
  orderId,
  engagementIdOnChain,
  amountETH,
  escrowAddress,
  expectedChainId,
  counterpartyName,
}: {
  orderId: string;
  engagementIdOnChain: number;
  amountETH: number;
  escrowAddress: Address;
  expectedChainId: number;
  counterpartyName: string;
}) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "wallet" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!connectedAddress) {
      setError("Connect your wallet to fund this order.");
      return;
    }
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }
      setStep("wallet");
      const amountWei = ethToWei(amountETH);
      const txHash: Hex = await writeContractAsync({
        chainId: expectedChainId,
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: "fundMilestone",
        args: [BigInt(engagementIdOnChain), amountWei],
        value: amountWei,
      });
      setStep("verifying");
      const fin = await fetch(`/api/orders/${orderId}/funded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!fin.ok) {
        const body = await fin.json().catch(() => ({}));
        throw new Error(body?.error ?? "Server could not verify the funding tx.");
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
  const label = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "verifying": return "Verifying receipt…";
      default: return `Fund ${formatETH(amountETH)}`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="primary" data-testid="fund-order" disabled={!connectedAddress}>
          <Check className="h-4 w-4" aria-hidden /> Fund order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Fund {formatETH(amountETH)} for this order?</DialogTitle>
        <DialogDescription>
          The amount moves into the smart-contract escrow. {counterpartyName} cannot withdraw it — funds release
          only when you approve the work. The tx is final once it confirms.
        </DialogDescription>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="primary">
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {label}
              </>
            ) : (
              label
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

function ReleaseButton({
  orderId,
  engagementIdOnChain,
  milestoneIndex,
  amountETH,
  escrowAddress,
  expectedChainId,
  counterpartyName,
}: {
  orderId: string;
  engagementIdOnChain: number;
  milestoneIndex: number;
  amountETH: number;
  escrowAddress: Address;
  expectedChainId: number;
  counterpartyName: string;
}) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "wallet" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!connectedAddress) {
      setError("Connect your wallet to release this order.");
      return;
    }
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
        args: [BigInt(engagementIdOnChain), BigInt(milestoneIndex)],
      });
      setStep("verifying");
      const fin = await fetch(`/api/orders/${orderId}/released`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!fin.ok) {
        const body = await fin.json().catch(() => ({}));
        throw new Error(body?.error ?? "Server could not verify the release tx.");
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
  const label = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "verifying": return "Verifying receipt…";
      default: return `Release ${formatETH(amountETH)}`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="primary" data-testid="release-order" disabled={!connectedAddress}>
          <Check className="h-4 w-4" aria-hidden /> Release funds
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Release {formatETH(amountETH)} to {counterpartyName}?</DialogTitle>
        <DialogDescription>
          Releasing sends the escrowed amount to {counterpartyName} on chain. Your wallet signs the release. Final.
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
                {label}
              </>
            ) : (
              label
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Decline (client) / Cancel (lawyer) — both no-chain
// ---------------------------------------------------------------------------

function DeclineButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/decline`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" onClick={() => void submit()} disabled={busy} data-testid="decline-order">
      <X className="h-4 w-4" aria-hidden /> {busy ? "Declining…" : "Decline"}
    </Button>
  );
}

function CancelButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" onClick={() => void submit()} disabled={busy} data-testid="cancel-order">
      <X className="h-4 w-4" aria-hidden /> {busy ? "Cancelling…" : "Rescind order"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ethToWei(eth: number): bigint {
  const fixed = eth.toFixed(18);
  const [whole, frac = ""] = fixed.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
}
