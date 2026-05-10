"use client";

import { useState } from "react";
import { ArrowRight, Lock, Pen } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useSignTypedData } from "wagmi";
import type { Address, Hex } from "viem";
import { parseEther } from "viem";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { formatETH } from "@/lib/utils/format";
import {
  BOOKING_TYPES,
  buildBookingDomain,
  generateBookingNonce,
  hashCaseDescription,
} from "@/lib/web3/booking-eip712";

interface BookingFormProps {
  lawyer: {
    id: string;
    name: string;
    city: string;
    specialty: string;
    consultationRate30: number;
    consultationRate60: number;
    pricingHeadline: string;
  };
  /**
   * Chain context — passed from a wrapper that reads server-only addresses.
   * Optional here so the form can render without the wrapper; if omitted
   * we fall back to public env at submit time.
   */
  escrowAddress?: Address;
  expectedChainId?: number;
}

const PRACTICE_AREAS = ["Family", "Estate", "Property", "Employment", "Immigration", "Business", "Tax", "IP"];

function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 30, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function BookingForm({ lawyer, escrowAddress, expectedChainId }: BookingFormProps) {
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();

  const [duration, setDuration] = useState<30 | 60>(60);
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime());
  const [practiceArea, setPracticeArea] = useState(PRACTICE_AREAS[0]);
  const [caseDescription, setCaseDescription] = useState("");
  const [step, setStep] = useState<"idle" | "wallet" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  const fee = duration === 30 ? lawyer.consultationRate30 : lawyer.consultationRate60;

  const submit = async () => {
    if (!caseDescription.trim()) {
      setError("Please add a short description of your case.");
      return;
    }
    if (!connectedAddress) {
      setError("Connect your wallet to sign the booking request.");
      return;
    }
    setError(null);
    try {
      // Resolve chain config — prefer props, otherwise fall back to env.
      const targetChainId =
        expectedChainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337");
      const verifyingContract =
        escrowAddress ?? (process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined);
      if (!verifyingContract) {
        setError("Escrow contract address not configured.");
        return;
      }

      if (chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      // Build the typed payload — every field is what the server will
      // canonicalise from the lawyer profile + form. If anything drifts
      // (different rate, different time, different description), recovery
      // returns the wrong address and the server rejects.
      const nonce = generateBookingNonce();
      const scheduledAtUnix = BigInt(Math.floor(new Date(scheduledAt).getTime() / 1000));
      const consultationFeeWei = parseEther(fee.toFixed(18));
      const message = {
        client: connectedAddress,
        lawyerProfileId: lawyer.id,
        scheduledAtUnix,
        durationMinutes: BigInt(duration),
        consultationFeeWei,
        practiceArea,
        caseDescriptionHash: hashCaseDescription(caseDescription),
        nonce,
      } as const;

      setStep("wallet");
      const signature: Hex = await signTypedDataAsync({
        domain: buildBookingDomain({ chainId: targetChainId, verifyingContract }),
        types: BOOKING_TYPES,
        primaryType: "BookingRequest",
        message,
      });

      setStep("submitting");
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lawyerProfileId: lawyer.id,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: duration,
          practiceArea,
          caseDescription,
          signature,
          nonce,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not create booking");
        return;
      }
      const data = (await res.json()) as { booking: { id: string } };
      window.location.href = `/client/cases?just-booked=${data.booking.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  const buttonLabel = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "submitting": return "Sending…";
      default: return "Sign & send request";
    }
  })();
  const busy = step !== "idle";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6 rounded-2xl border border-slate-100 bg-white-0 p-7">
        <div className="flex items-center gap-3.5">
          <AvatarBubble name={lawyer.name} size={48} verified />
          <div>
            <div className="text-[15px] font-semibold text-navy-900">{lawyer.name}</div>
            <div className="text-[13px] text-slate-500">
              {lawyer.specialty} · {lawyer.city}
            </div>
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Date & time</Label>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>

        <div>
          <Label className="mb-2 block">Duration</Label>
          <RadioGroup value={String(duration)} onValueChange={(v) => setDuration(Number(v) as 30 | 60)} className="grid grid-cols-2 gap-3">
            {[30, 60].map((d) => (
              <label
                key={d}
                className={
                  duration === d
                    ? "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-teal-500 bg-teal-50 p-4"
                    : "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-100 bg-white-0 p-4"
                }
              >
                <RadioGroupItem value={String(d)} />
                <div>
                  <div className="text-[14px] font-semibold text-navy-900">{d}-minute consultation</div>
                  <div className="text-[12px] text-slate-500">
                    {formatETH(d === 30 ? lawyer.consultationRate30 : lawyer.consultationRate60)}
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div>
          <Label className="mb-2 block">Practice area</Label>
          <select
            value={practiceArea}
            onChange={(e) => setPracticeArea(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px] text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-50"
          >
            {PRACTICE_AREAS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="mb-2 block">Tell your lawyer about the case</Label>
          <Textarea
            value={caseDescription}
            onChange={(e) => {
              setCaseDescription(e.target.value);
              if (error) setError(null);
            }}
            rows={6}
            placeholder="Briefly describe your situation. The lawyer sees this before accepting."
          />
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Consultation fee</div>
          <div className="mt-2 font-display text-3xl text-navy-900">{formatETH(fee)}</div>
          <div className="mt-1 text-[12px] text-slate-500">
            {duration}-minute consultation at {lawyer.name.split(" ")[0]}'s published rate.
          </div>
          <hr className="my-5 border-t border-slate-100" />
          <p className="text-[12px] leading-[1.55] text-slate-500">
            Sending this request signs an EIP-712 message with your wallet — proof you authorised
            this specific booking. No funds move yet. If {lawyer.name.split(" ")[0]} accepts, you'll be
            prompted to fund the escrow on chain.
          </p>
          <Button
            onClick={submit}
            disabled={busy || !connectedAddress}
            size="lg"
            className="mt-5 w-full"
          >
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {buttonLabel}
              </>
            ) : (
              <>
                <Pen className="h-4 w-4" aria-hidden /> {buttonLabel} <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </Button>
          {!connectedAddress && (
            <p className="mt-3 text-[12px] text-amber-700">Wallet not connected — connect from the top bar.</p>
          )}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
            <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Both parties must sign before any payment moves.
          </p>
          {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
