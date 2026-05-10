"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ESCROW_ABI, ZERO_BYTES32 } from "@/lib/web3/escrow";

/**
 * Open a dispute on a funded milestone. Either party can do this:
 *
 *   • CLIENT  → `disputeMilestone(eid, msIdx, transcriptRoot)` (no cooldown).
 *   • LAWYER  → `escalateMilestone(eid, msIdx, transcriptRoot)` (cooldown
 *               applies in production; demo cooldown = 0 so the lawyer can
 *               escalate immediately).
 *
 * Both produce the same `MilestoneDisputed` event, which is what the
 * /disputed endpoint validates. The contract gates each call to the right
 * role, so the wrong party calling the wrong function reverts on chain.
 */
interface DisputeButtonProps {
  kind: "booking" | "order";
  /** Booking id or Order id. */
  id: string;
  engagementIdOnChain: number;
  milestoneIndex: number;
  escrowAddress: Address;
  expectedChainId: number;
  counterpartyName: string;
  /** Determines whether disputeMilestone (client) or escalateMilestone (lawyer)
   *  is called. The contract gate is the source of truth — this just picks
   *  the right ABI entry. */
  perspective: "client" | "lawyer";
}

export function DisputeButton({
  kind,
  id,
  engagementIdOnChain,
  milestoneIndex,
  escrowAddress,
  expectedChainId,
  counterpartyName,
  perspective,
}: DisputeButtonProps) {
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
      setError("Connect your wallet to open a dispute.");
      return;
    }
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }
      setStep("wallet");
      const fn = perspective === "lawyer" ? "escalateMilestone" : "disputeMilestone";
      const txHash: Hex = await writeContractAsync({
        chainId: expectedChainId,
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: fn,
        args: [BigInt(engagementIdOnChain), BigInt(milestoneIndex), ZERO_BYTES32],
      });

      setStep("verifying");
      const fin = await fetch(
        `/api/${kind === "booking" ? "bookings" : "orders"}/${id}/disputed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        },
      );
      if (!fin.ok) {
        const data = await fin.json().catch(() => ({}));
        throw new Error(data?.error ?? "Server could not verify the dispute tx.");
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
      default: return "Open dispute";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="ghost" data-testid="dispute-open" disabled={!connectedAddress}>
          <AlertTriangle className="h-4 w-4" aria-hidden /> Open dispute
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Open a dispute on this milestone?</DialogTitle>
        <DialogDescription>
          The escrowed funds stay locked until the platform operator reviews the conversation and decides
          how to split them between you and {counterpartyName}. After this tx confirms, both you and{" "}
          {counterpartyName} will be prompted to submit your encrypted conversation archive to the
          arbiter — that's how they read the chat without holding either of your private keys.
        </DialogDescription>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant="primary">
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {label}
              </>
            ) : (
              <>{label}</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
