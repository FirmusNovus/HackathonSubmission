"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ClientSignButton({ bookingId, lawyerSigned }: { bookingId: string; lawyerSigned: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/sign`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not sign the invoice.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50 p-5">
      <h3 className="font-display text-lg text-navy-900">
        {lawyerSigned ? "Sign to release escrow" : "Sign this invoice"}
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
        {lawyerSigned
          ? "Your lawyer has already signed. Your signature funds the smart-contract escrow and confirms the consultation."
          : "Both you and your lawyer must sign before any payment moves. Your signature is recorded on this invoice now; funds move into escrow once the lawyer also signs."}
      </p>
      <Button onClick={sign} disabled={busy} className="mt-4">
        <Check className="h-4 w-4" aria-hidden /> {busy ? "Signing…" : "Sign invoice"}
      </Button>
      {error && <p className="mt-2 text-[13px] text-red-500">{error}</p>}
    </div>
  );
}
