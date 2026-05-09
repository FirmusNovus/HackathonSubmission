"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStatus } from "@/lib/db/enums";

export function RequestActions({
  bookingId,
  status,
  clientSigned,
  lawyerSigned,
}: {
  bookingId: string;
  // Booking.status is a plain string from Prisma (SQLite has no enums); we
  // accept any string and compare against the BookingStatus values.
  status: string;
  clientSigned: boolean;
  lawyerSigned: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const decided = status !== BookingStatus.REQUESTED;

  const action = async (kind: "accept" | "decline") => {
    setBusy(kind);
    try {
      await fetch(`/api/bookings/${bookingId}/${kind}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (decided) {
    return (
      <p className="mt-8 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        This request has already been {status.toLowerCase()}.
      </p>
    );
  }

  // Lawyer-initiated invoice waiting on the client.
  if (lawyerSigned && !clientSigned) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-6 text-[13px] text-slate-500">
        <Calendar className="h-3.5 w-3.5" aria-hidden /> You signed this invoice. Waiting for the client to counter-sign
        before escrow funds.
      </p>
    );
  }

  // Standard accept/decline path (client-initiated, lawyer hasn't signed yet).
  // F3: escrow is ALREADY funded by the client at booking-creation time —
  // accepting is a UX confirmation, not a fund-now action. Decline does NOT
  // refund automatically; F6 wires the mutual-refund flow.
  return (
    <div className="mt-8 flex flex-wrap justify-end gap-2.5 border-t border-slate-100 pt-6">
      <Button variant="ghost" onClick={() => action("decline")} disabled={!!busy}>
        <X className="h-4 w-4" aria-hidden /> Decline
      </Button>
      <Button variant="outline" disabled>
        <Calendar className="h-4 w-4" aria-hidden /> Suggest different time
      </Button>
      <Button variant="primary" onClick={() => action("accept")} disabled={!!busy}>
        <Check className="h-4 w-4" aria-hidden />{" "}
        {busy === "accept" ? "Accepting…" : "Accept consultation"}
      </Button>
    </div>
  );
}
