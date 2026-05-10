"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleSlash, RotateCcw } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useSignTypedData, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ESCROW_ABI } from "@/lib/web3/escrow";
import {
  REFUND_TYPES,
  buildRefundDomain,
  type RefundAuthorizationPayload,
} from "@/lib/web3/refund-eip712";

/**
 * Mutual refund flow. Either party can initiate; the other co-signs and
 * submits the on-chain `mutualRefundMilestone` tx. Render is keyed on
 * current refund state (passed in from the realtime hook in the parent),
 * so this stays a pure stateless React component aside from the wallet
 * interaction transitions.
 *
 * Used for both bookings (kind="booking", milestone 0) and follow-up
 * orders (kind="order", milestone 1+). The signing endpoint differs
 * (`/api/{bookings,orders}/[id]/refund/sign`); everything else is shared.
 */

export interface RefundActionsProps {
  kind: "booking" | "order";
  /** Booking id or Order id. */
  id: string;
  engagementIdOnChain: number;
  milestoneIndex: number;
  perspective: "client" | "lawyer";
  selfSigned: boolean;
  otherSigned: boolean;
  proposedBy: "CLIENT" | "LAWYER" | null;
  refunded: boolean;
  /** Counter-party display name for dialog copy. */
  counterpartyName: string;
  escrowAddress: Address;
  expectedChainId: number;
}

export function RefundActions(props: RefundActionsProps) {
  if (props.refunded) return null;

  if (props.selfSigned && props.otherSigned) {
    // Both signed; sit tight while the second signer's tx confirms — they
    // already triggered the submit in the same dialog. If for some reason
    // the page is re-opened in this state without a pending tx, the
    // "submit refund" button below lets the user push it through.
    return <SubmitRefundButton {...props} />;
  }

  if (props.selfSigned && !props.otherSigned) {
    return (
      <p className="text-[12px] text-amber-700">
        You proposed cancellation — waiting for {props.counterpartyName} to co-sign so the refund can hit chain.
      </p>
    );
  }

  if (!props.selfSigned && props.otherSigned) {
    return <CoSignButton {...props} />;
  }

  // No sigs yet — initial proposal.
  return <ProposeButton {...props} />;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function ProposeButton(props: RefundActionsProps) {
  return <RefundDialog {...props} mode="propose" />;
}

function CoSignButton(props: RefundActionsProps) {
  return <RefundDialog {...props} mode="co-sign" />;
}

function SubmitRefundButton(props: RefundActionsProps) {
  return <RefundDialog {...props} mode="submit-only" />;
}

// ---------------------------------------------------------------------------
// Dialog — handles all three transitions
// ---------------------------------------------------------------------------

interface RefundDialogProps extends RefundActionsProps {
  mode: "propose" | "co-sign" | "submit-only";
}

function RefundDialog({
  kind,
  id,
  engagementIdOnChain,
  milestoneIndex,
  counterpartyName,
  escrowAddress,
  expectedChainId,
  selfSigned,
  otherSigned,
  mode,
}: RefundDialogProps) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "signing" | "submitting" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  const signEndpoint = `/api/${kind === "booking" ? "bookings" : "orders"}/${id}/refund/sign`;
  const refundedEndpoint = `/api/${kind === "booking" ? "bookings" : "orders"}/${id}/refunded`;

  const submit = async () => {
    setError(null);
    if (!connectedAddress) {
      setError("Connect your wallet to sign the refund.");
      return;
    }
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }

      // Sign step — skipped only in submit-only mode (both already signed).
      if (mode !== "submit-only") {
        setStep("signing");
        const message: RefundAuthorizationPayload = {
          engagementId: BigInt(engagementIdOnChain),
          milestoneIndex: BigInt(milestoneIndex),
        };
        const signature = await signTypedDataAsync({
          domain: buildRefundDomain({ chainId: expectedChainId, verifyingContract: escrowAddress }),
          types: REFUND_TYPES,
          primaryType: "MutualRefundAuthorization",
          message,
        });
        const sigRes = await fetch(signEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        });
        if (!sigRes.ok) {
          const body = await sigRes.json().catch(() => ({}));
          throw new Error(body?.error ?? `Could not record signature (${sigRes.status})`);
        }
        const { bothSigsPresent } = (await sigRes.json()) as { bothSigsPresent?: boolean };
        if (!bothSigsPresent) {
          // Just the proposer's sig — wait for counterparty.
          setOpen(false);
          router.refresh();
          return;
        }
      }

      // Both sigs present. The contract recovers them from calldata, so we
      // pull them straight from the signing endpoint's response chain — but
      // the API doesn't echo the other party's sig. Instead, ask the server
      // for the merged sigs.
      setStep("submitting");
      const sigsRes = await fetch(`/api/${kind === "booking" ? "bookings" : "orders"}/${id}/refund/sigs`);
      if (!sigsRes.ok) {
        const body = await sigsRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not fetch counterparty signature.");
      }
      const { clientSig, lawyerSig } = (await sigsRes.json()) as {
        clientSig?: Hex;
        lawyerSig?: Hex;
      };
      if (!clientSig || !lawyerSig) {
        throw new Error("Server is missing one of the two refund signatures.");
      }

      const txHash: Hex = await writeContractAsync({
        chainId: expectedChainId,
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: "mutualRefundMilestone",
        args: [BigInt(engagementIdOnChain), BigInt(milestoneIndex), clientSig, lawyerSig],
      });

      setStep("verifying");
      const fin = await fetch(refundedEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      if (!fin.ok) {
        const body = await fin.json().catch(() => ({}));
        throw new Error(body?.error ?? "Server could not verify the refund tx.");
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

  const triggerLabel = (() => {
    if (mode === "propose") return "Cancel & refund";
    if (mode === "co-sign") return "Co-sign & refund";
    return "Submit refund tx";
  })();
  const triggerIcon = mode === "propose" ? CircleSlash : RotateCcw;
  const Trigger = triggerIcon;

  const stepLabel = (() => {
    switch (step) {
      case "signing": return "Confirm signature in wallet…";
      case "submitting": return "Confirm refund tx in wallet…";
      case "verifying": return "Verifying receipt…";
      default: return triggerLabel;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button
          variant={mode === "propose" ? "ghost" : "primary"}
          data-testid={`refund-${mode}`}
          disabled={!connectedAddress}
        >
          <Trigger className="h-4 w-4" aria-hidden /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>
          {mode === "propose" && "Cancel & refund?"}
          {mode === "co-sign" && `Refund agreed by ${counterpartyName}.`}
          {mode === "submit-only" && "Submit the refund tx?"}
        </DialogTitle>
        <DialogDescription>
          {mode === "propose" && (
            <>
              You're asking to cancel this engagement and return the escrow to the client. Both you and{" "}
              {counterpartyName} have to sign — this step records your signature. Funds only move on chain
              after the second signature lands.
            </>
          )}
          {mode === "co-sign" && (
            <>
              {counterpartyName} signed a refund authorisation. Co-signing returns the escrowed amount to
              the client on chain in a single tx.
            </>
          )}
          {mode === "submit-only" && (
            <>
              Both signatures are on file. Submitting calls{" "}
              <code className="font-mono text-[11px]">mutualRefundMilestone</code> on chain — the milestone's
              ETH is released back to the client.
            </>
          )}
        </DialogDescription>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        {selfSigned && otherSigned && mode === "co-sign" && (
          <p className="mt-2 text-[12px] text-slate-500">
            (Both sigs already on file — the next click only submits the tx.)
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="primary">
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {stepLabel}
              </>
            ) : (
              <>{stepLabel}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
