import { Check, Clock, FileText, Lock } from "lucide-react";
import type { Deliverable, LineItem } from "@/types";
import { formatEUR } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface InvoiceCardProps {
  /** Booking id, used as the invoice number. */
  bookingId: string;
  lineItems: LineItem[];
  deliverables: Deliverable[];
  totalEUR: number;
  platformFeeEUR: number;
  clientAcceptedAt: string | Date | null;
  lawyerAcceptedAt: string | Date | null;
  clientName?: string;
  lawyerName?: string;
  className?: string;
}

/**
 * Read-only invoice + dual-signature panel. Both parties' acceptance state is
 * shown explicitly so the user always knows what's blocking payment.
 *
 *     ┌───────────────────────────────────────────────┐
 *     │ Invoice INV-…                                 │
 *     │                                               │
 *     │ Line items …                  Subtotal  €240  │
 *     │ Deliverables …                                │
 *     │                                               │
 *     │ Total: €252                                   │
 *     │                                               │
 *     │ Signatures                                    │
 *     │  ✓ Sarah Mueller (client)  • Mar 12, 14:21   │
 *     │  ⏳ Maria Chen (lawyer)    awaiting          │
 *     └───────────────────────────────────────────────┘
 */
export function InvoiceCard({
  bookingId,
  lineItems,
  deliverables,
  totalEUR,
  platformFeeEUR,
  clientAcceptedAt,
  lawyerAcceptedAt,
  clientName = "Client",
  lawyerName = "Lawyer",
  className,
}: InvoiceCardProps) {
  const grand = totalEUR + platformFeeEUR;
  const both = Boolean(clientAcceptedAt && lawyerAcceptedAt);
  return (
    <article className={cn("rounded-2xl border border-slate-100 bg-white-0 p-6 shadow-[var(--shadow-sm)]", className)}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Invoice</span>
          <h3 className="font-mono text-[13px] text-slate-700">INV-{bookingId.slice(-8).toUpperCase()}</h3>
        </div>
        <FileText className="h-5 w-5 text-slate-300" aria-hidden />
      </header>

      <section aria-label="Line items" className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Line items</div>
        <ul className="mt-2 divide-y divide-slate-100">
          {lineItems.map((li) => (
            <li key={li.id} className="grid grid-cols-[1fr_auto] gap-x-4 py-2.5 text-[14px]">
              <div>
                <div className="font-medium text-navy-900">{li.title}</div>
                <div className="text-[12px] text-slate-500">
                  {li.kind === "hourly"
                    ? `${li.hours ?? 0} hr × ${formatEUR(li.ratePerHour ?? 0)}/hr`
                    : "Fixed price"}
                  {li.description ? ` · ${li.description}` : ""}
                </div>
              </div>
              <div className="self-center font-medium text-navy-900">{formatEUR(li.subtotal)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Deliverables" className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
          Deliverables / objectives
        </div>
        <ul className="mt-2 space-y-1.5">
          {deliverables.map((d) => (
            <li key={d.id} className="flex items-start gap-2 text-[14px] text-navy-900">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden strokeWidth={2.25} />
              <div>
                <div className="font-medium">{d.title}</div>
                {d.description && <div className="text-[12px] text-slate-500">{d.description}</div>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Totals" className="mt-5 rounded-lg bg-white-50 p-4 text-[13px]">
        <Row label="Subtotal" value={formatEUR(totalEUR)} />
        <Row label="Platform fee (5%)" value={formatEUR(platformFeeEUR)} />
        <hr className="my-2 border-t border-slate-100" />
        <Row label="Total in escrow on dual signoff" value={formatEUR(grand)} bold />
      </section>

      <section aria-label="Signatures" className="mt-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Signatures</div>
        <ul className="mt-2 space-y-2">
          <SignatureRow role="client" name={clientName} acceptedAt={clientAcceptedAt} />
          <SignatureRow role="lawyer" name={lawyerName} acceptedAt={lawyerAcceptedAt} />
        </ul>
        <p className={cn("mt-3 inline-flex items-center gap-1.5 text-[12px]", both ? "text-teal-700" : "text-slate-500")}>
          <Lock className="h-3 w-3" aria-hidden />
          {both
            ? "Both parties signed — funds held in escrow until the consultation completes."
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
