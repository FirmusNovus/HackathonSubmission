"use client";

import { Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessagingKeys } from "@/lib/hooks/use-messaging-keys";

/**
 * Operator-only affordance to derive + enroll the X25519 messaging keypair.
 * Disputing parties re-encrypt their conversation archive to the operator's
 * pubkey; without an enrolled key, the operator cannot decrypt those archives
 * and `/admin/disputes/*` would render empty panels. Surfacing the enroll
 * button on the dashboard means the operator signs once at first login and
 * every subsequent dispute view Just Works.
 */
export function OperatorMessagingEnroll() {
  const { keypair, enrolling, error, enroll } = useMessagingKeys();

  if (keypair) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-[13px] text-teal-800">
        <Check className="h-4 w-4" aria-hidden /> Decryption key enrolled — dispute archives will decrypt automatically.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 text-amber-700" aria-hidden />
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-amber-900">Decryption key not enrolled</div>
          <p className="mt-0.5 text-[12px] text-amber-800">
            Sign once with the operator wallet so dispute archives uploaded by clients/lawyers can be decrypted in your browser.
          </p>
          {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
        </div>
        <Button onClick={() => void enroll()} disabled={enrolling} size="sm">
          {enrolling ? "Signing…" : "Enable"}
        </Button>
      </div>
    </div>
  );
}
