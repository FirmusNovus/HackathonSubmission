import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatETH, formatScheduled, truncateAddress } from "@/lib/utils/format";

/**
 * Per-engagement summary view from the lawyer's perspective. Lists the
 * consultation booking that opened the engagement plus every follow-up
 * Order, with their statuses. Links to the existing per-row detail pages
 * (`/lawyer/orders/[bookingId]` for the consultation, `/lawyer/follow-ups/[orderId]`
 * for follow-ups).
 */
export default async function LawyerEngagementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireLawyer();
  const { id } = await params;

  const engagement = await prisma.engagement.findUnique({
    where: { id },
    include: {
      client: true,
      lawyerProfile: { include: { user: true } },
      booking: true,
      orders: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!engagement || engagement.lawyerProfile.userId !== session.user.id) notFound();

  const clientName = engagement.client.name ?? truncateAddress(engagement.client.walletAddress);
  // A row's funds are "locked" only if escrow was funded AND none of release/refund/dispute-resolve has fired.
  // Pre-Phase-11 this only checked release+refund, which left dispute-resolved rows still showing as locked.
  const totalLocked = [engagement.booking, ...engagement.orders]
    .filter(
      (row) =>
        row &&
        (row as { escrowTxHash?: string | null }).escrowTxHash &&
        !(row as { escrowReleaseHash?: string | null }).escrowReleaseHash &&
        !(row as { escrowRefundHash?: string | null }).escrowRefundHash &&
        !(row as { disputeResolveTxHash?: string | null }).disputeResolveTxHash,
    )
    .reduce((sum, row) => {
      if (!row) return sum;
      if ("consultationFeeEUR" in row) return sum + Number((row as { consultationFeeEUR: unknown }).consultationFeeEUR);
      return sum + Number((row as { amountETH: unknown }).amountETH);
    }, 0);

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="orders" />
      <main className="mx-auto max-w-[960px] px-6 py-10 lg:px-8">
        <Link
          href="/lawyer/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-3xl text-navy-900">Engagement with {clientName}</h1>
          <Badge kind={engagement.status === "ACTIVE" ? "info" : "neutral"}>{engagement.status.toLowerCase()}</Badge>
        </div>
        <p className="mt-2 font-mono text-[12px] text-slate-500">
          Chain id #{engagement.engagementIdOnChain} · matter {truncateAddress(engagement.matterRef)}
        </p>

        <section className="mt-7 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <Row label="Total in escrow" value={totalLocked > 0 ? formatETH(totalLocked) : "—"} />
          <Row label="Opened" value={engagement.openedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
          <Row label="Orders" value={`1 consultation + ${engagement.orders.length} follow-up${engagement.orders.length === 1 ? "" : "s"}`} />
        </section>

        <section className="mt-6 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">Consultation</h2>
          </div>
          {engagement.booking ? (
            <ConsultationRow
              href={`/lawyer/orders/${engagement.booking.id}`}
              practiceArea={engagement.booking.practiceArea}
              scheduledAt={engagement.booking.scheduledAt.toISOString()}
              durationMinutes={engagement.booking.durationMinutes}
              fee={Number(engagement.booking.consultationFeeEUR)}
              status={engagement.booking.status}
              hasEscrow={Boolean(engagement.booking.escrowTxHash)}
              isReleased={Boolean(engagement.booking.escrowReleaseHash)}
              isRefunded={Boolean(engagement.booking.escrowRefundHash)}
              isResolved={Boolean(engagement.booking.disputeResolveTxHash)}
            />
          ) : (
            <p className="mt-3 text-[13px] text-slate-500">No consultation row found for this engagement.</p>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">Follow-up orders</h2>
            <Button asChild variant="outline" size="sm">
              <Link href={`/lawyer/orders/new?engagement=${engagement.id}`}>
                <FileText className="h-3.5 w-3.5" aria-hidden /> New follow-up
              </Link>
            </Button>
          </div>
          {engagement.orders.length === 0 ? (
            <p className="mt-4 text-[13px] text-slate-500">No follow-up orders yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {engagement.orders.map((o) => (
                <OrderListRow
                  key={o.id}
                  href={`/lawyer/follow-ups/${o.id}`}
                  description={o.description}
                  amount={Number(o.amountETH)}
                  status={o.status}
                  milestoneIndex={o.milestoneIndex}
                  isReleased={Boolean(o.escrowReleaseHash)}
                  isRefunded={Boolean(o.escrowRefundHash)}
                  isResolved={Boolean(o.disputeResolveTxHash)}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <span className="text-[14px] font-medium text-navy-900">{value}</span>
    </div>
  );
}

function ConsultationRow({
  href,
  practiceArea,
  scheduledAt,
  durationMinutes,
  fee,
  status,
  hasEscrow,
  isReleased,
  isRefunded,
  isResolved,
}: {
  href: string;
  practiceArea: string;
  scheduledAt: string;
  durationMinutes: number;
  fee: number;
  status: string;
  hasEscrow: boolean;
  isReleased: boolean;
  isRefunded: boolean;
  isResolved: boolean;
}) {
  const phase = isResolved
    ? "resolved"
    : isRefunded
      ? "refunded"
      : isReleased
        ? "released"
        : hasEscrow
          ? "in-escrow"
          : status.toLowerCase();
  return (
    <Link href={href} className="mt-3 block rounded-lg border border-slate-100 p-4 transition-colors hover:border-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-navy-900">{practiceArea} · {durationMinutes}-min consultation</div>
          <div className="mt-1 text-[12px] text-slate-500">{formatScheduled(new Date(scheduledAt))}</div>
        </div>
        <div className="text-right">
          <div className="text-[14px] font-medium text-navy-900">{formatETH(fee)}</div>
          <Badge kind={phaseToKind(phase)}>{phase}</Badge>
        </div>
      </div>
    </Link>
  );
}

function OrderListRow({
  href,
  description,
  amount,
  status,
  milestoneIndex,
  isReleased,
  isRefunded,
  isResolved,
}: {
  href: string;
  description: string;
  amount: number;
  status: string;
  milestoneIndex: number | null;
  isReleased: boolean;
  isRefunded: boolean;
  isResolved: boolean;
}) {
  const phase = isResolved ? "resolved" : isRefunded ? "refunded" : isReleased ? "released" : status.toLowerCase();
  return (
    <li className="py-3">
      <Link href={href} className="block rounded-lg p-2 transition-colors hover:bg-slate-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[14px] text-navy-900">{description}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {milestoneIndex !== null ? <>Milestone #{milestoneIndex} · </> : null}
              {status === "ACCEPTED" && <span className="inline-flex items-center gap-1 text-teal-700"><ShieldCheck className="h-3 w-3" aria-hidden /> in escrow</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[14px] font-medium text-navy-900">{formatETH(amount)}</div>
            <Badge kind={phaseToKind(phase)}>{phase}</Badge>
          </div>
        </div>
      </Link>
    </li>
  );
}

function phaseToKind(phase: string): "pending" | "info" | "success" | "neutral" | "error" {
  if (phase === "released") return "success";
  if (phase === "resolved" || phase === "refunded" || phase === "cancelled" || phase === "declined") return "neutral";
  if (phase === "disputed") return "error";
  if (phase === "in-escrow" || phase === "accepted") return "info";
  return "pending";
}
