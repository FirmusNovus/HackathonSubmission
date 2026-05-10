"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useSignTypedData } from "wagmi";
import type { Address } from "viem";
import { parseEther } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatETH } from "@/lib/utils/format";
import {
  ORDER_CREATE_TYPES,
  buildOrderDomain,
  generateOrderNonce,
  hashOrderDescription,
  type OrderCreatePayload,
} from "@/lib/web3/order-eip712";

interface EngagementOption {
  id: string;
  engagementIdOnChain: number;
  clientName: string;
  practiceArea: string;
  openedAt: string;
}

export function NewOrderForm({
  initialEngagementId,
  engagements,
  escrowAddress,
  expectedChainId,
}: {
  initialEngagementId: string;
  engagements: EngagementOption[];
  escrowAddress: Address;
  expectedChainId: number;
}) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [engagementId, setEngagementId] = useState(initialEngagementId || engagements[0]?.id || "");
  const [description, setDescription] = useState("");
  const [amountETH, setAmountETH] = useState(0.05);
  const [step, setStep] = useState<"idle" | "wallet" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  const selectedEngagement = engagements.find((e) => e.id === engagementId);

  const submit = async () => {
    if (!connectedAddress) {
      setError("Connect your wallet to sign the order.");
      return;
    }
    if (!selectedEngagement) {
      setError("Select an engagement.");
      return;
    }
    setError(null);
    try {
      if (chainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }
      const nonce = generateOrderNonce();
      const message: OrderCreatePayload = {
        lawyer: connectedAddress,
        engagementId: selectedEngagement.id,
        engagementIdOnChain: BigInt(selectedEngagement.engagementIdOnChain),
        amountWei: parseEther(amountETH.toFixed(18)),
        descriptionHash: hashOrderDescription(description),
        nonce,
      };
      setStep("wallet");
      const signature = await signTypedDataAsync({
        domain: buildOrderDomain({ chainId: expectedChainId, verifyingContract: escrowAddress }),
        types: ORDER_CREATE_TYPES,
        primaryType: "OrderCreate",
        message,
      });

      setStep("submitting");
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, description, amountETH, signature, nonce }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const { order } = (await res.json()) as { order: { id: string } };
      router.push(`/lawyer/follow-ups/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  const valid = engagementId && description.trim().length > 0 && amountETH > 0;
  const busy = step !== "idle";
  const buttonLabel = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "submitting": return "Sending…";
      default: return "Sign & send order";
    }
  })();

  return (
    <form
      className="mt-8 space-y-6 rounded-2xl border border-slate-100 bg-white-0 p-7"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void submit();
      }}
    >
      <div>
        <Label className="mb-2 block">Engagement</Label>
        <select
          value={engagementId}
          onChange={(e) => setEngagementId(e.target.value)}
          className="h-11 w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px]"
          required
        >
          {engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.clientName} · {e.practiceArea} · opened{" "}
              {new Date(e.openedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label className="mb-2 block">What's the work?</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Draft an updated will reflecting the changes we discussed. Includes one round of revisions."
          rows={4}
          required
        />
      </div>

      <div>
        <Label className="mb-2 block">Amount (ETH)</Label>
        <Input
          type="number"
          min={0}
          step="0.001"
          value={amountETH}
          onChange={(e) => setAmountETH(Number(e.target.value))}
          required
        />
        <p className="mt-1.5 text-[12px] text-slate-500">
          Total {formatETH(amountETH)} into escrow when the client funds. Funds release to you when the client signs off.
        </p>
      </div>

      {error && <p className="text-[13px] text-red-500">{error}</p>}

      <div className="flex justify-end gap-2.5">
        <Button type="submit" variant="primary" disabled={!valid || busy || !connectedAddress}>
          <Send className="h-4 w-4" aria-hidden /> {buttonLabel}
        </Button>
      </div>
      {!connectedAddress && (
        <p className="text-right text-[12px] text-amber-700">Wallet not connected — connect from the top bar.</p>
      )}
    </form>
  );
}
