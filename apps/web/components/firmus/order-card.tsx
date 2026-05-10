import { Check, Clock, FileText, Lock } from "lucide-react";
import { formatETH } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface OrderCardProps {
  /** Booking id, used as the order number. */
  bookingId: string;
  durationMinutes: number;
  totalEUR: number;
  clientAcceptedAt: string | Date | null;
  lawyerAcceptedAt: string | Date | null;
  /** True only after the on-chain funding tx confirms (engagement opened). */
  funded?: boolean;
  clientName?: string;
  lawyerName?: string;
  className?: string;
}

/**
 * Read-only consultation summary + dual-signature panel. Phase 8 dropped
 * line items + deliverables (the consultation IS the deliverable; the price
 * is the lawyer's published rate × duration). Both parties' acceptance
 * state is shown explicitly so the user always knows what's blocking
 * payment.
 */
export function OrderCard({
  bookingId,
  durationMinutes,
  totalEUR,
  clientAcceptedAt,
  lawyerAcceptedAt,
  funded = false,
  clientName = "Client",
  lawyerName = "Lawyer",
  className,
}: OrderCardProps) {
  const both = Boolean(clientAcceptedAt && lawyerAcceptedAt);
  return (
    <article className={cn("rounded-2xl border border-slate-100 bg-white-0 p-6 shadow-[var(--shadow-sm)]", className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Order</span>
          <h3 className="font-mono text-[13px] text-slate-700">ORD-{bookingId.slice(-8).toUpperCase()}</h3>
        </div>
        <FileText className="h-5 w-5 text-slate-300" aria-hidden />
      </header>

      <section aria-label="Consultation" className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Consultation</div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 py-2.5 text-[14px]">
          <div>
            <div className="font-medium text-navy-900">{durationMinutes}-minute video consultation</div>
            <div className="text-[12px] text-slate-500">
              At the lawyer's published rate. The consultation is the deliverable; release escrow when done.
            </div>
          </div>
          <div className="self-center font-medium text-navy-900">{formatETH(totalEUR)}</div>
        </div>
      </section>

      <section aria-label="Total" className="mt-5 rounded-lg bg-white-50 p-4 text-[13px]">
        <Row label="In escrow on dual signoff" value={formatETH(totalEUR)} bold />
      </section>

      <section aria-label="Signatures" className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Signatures</div>
        <ul className="mt-2 space-y-2">
          <SignatureRow role="client" name={clientName} acceptedAt={clientAcceptedAt} />
          <SignatureRow role="lawyer" name={lawyerName} acceptedAt={lawyerAcceptedAt} />
        </ul>
        <p className={cn("mt-3 inline-flex items-center gap-1.5 text-[12px]", funded ? "text-teal-700" : "text-slate-500")}>
          <Lock className="h-3 w-3" aria-hidden />
          {funded
            ? "Funds locked in escrow on chain — released to the lawyer when the client signs off."
            : both
              ? "Both parties signed — client funds escrow next from their wallet."
              : "No funds move until both parties sign."}
        </p>
      </section>
    </article>
  );
}

function SignatureRow({
  role,
  name,
  acceptedAt,
}: {
  role: "client" | "lawyer";
  name: string;
  acceptedAt: string | Date | null;
}) {
  const signed = Boolean(acceptedAt);
  const when = acceptedAt ? new Date(acceptedAt) : null;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white-0 px-3 py-2">
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full",
          signed ? "bg-teal-50 text-teal-700" : "bg-slate-50 text-slate-400",
        )}
      >
        {signed ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Clock className="h-4 w-4" />}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-medium text-navy-900">
          {name} <span className="font-normal text-slate-500">({role})</span>
        </div>
        <div className="text-[11px] text-slate-500">
          {signed
            ? `Signed ${when?.toLocaleString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : "Awaiting signature"}
        </div>
      </div>
    </li>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-navy-900" : "text-slate-500"}>{label}</span>
      <span className={bold ? "font-semibold text-navy-900" : "text-navy-900"}>{value}</span>
    </div>
  );
}
