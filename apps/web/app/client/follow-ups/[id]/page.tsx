import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { OrderFollowUpActions } from "@/components/firmus/order-follow-up-actions";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { formatETH, truncateAddress } from "@/lib/utils/format";

export default async function ClientFollowUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireClient();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      engagement: {
        include: {
          client: true,
          lawyerProfile: { include: { user: true } },
          booking: true,
        },
      },
    },
  });
  if (!order || order.engagement.clientId !== session.user.id) notFound();

  const amount = Number(order.amountETH);
  const status = order.status;
  const lawyerName = order.engagement.lawyerProfile.user.name ?? "your lawyer";

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="cases" />
      <main className="mx-auto max-w-[760px] px-6 py-10 lg:px-8">
        <Link
          href={`/client/engagements/${order.engagement.id}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to engagement
        </Link>

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-3xl text-navy-900">Follow-up order from {lawyerName}</h1>
          <Badge kind={statusKind(status)}>{status.toLowerCase()}</Badge>
        </div>
        <p className="mt-2 font-mono text-[12px] text-slate-500">ORD-{order.id.slice(-8).toUpperCase()}</p>

        <section className="mt-7 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <Row label="Lawyer" value={lawyerName} />
          <Row label="Engagement" value={`#${order.engagement.engagementIdOnChain} · ${order.engagement.booking?.practiceArea ?? "—"}`} />
          <Row label="Amount" value={formatETH(amount)} />
          {order.milestoneIndex !== null && (
            <Row label="Milestone" value={`#${order.milestoneIndex}`} />
          )}
          {order.escrowTxHash && <Row label="Escrow tx" value={truncateAddress(order.escrowTxHash)} mono />}
          {order.escrowReleaseHash && <Row label="Release tx" value={truncateAddress(order.escrowReleaseHash)} mono />}
        </section>

        <section className="mt-6 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Description of work</div>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-navy-900">{order.description}</p>
        </section>

        <div className="mt-6 flex justify-end gap-2.5">
          <OrderFollowUpActions
            orderId={order.id}
            engagementIdOnChain={order.engagement.engagementIdOnChain}
            status={status}
            amountETH={amount}
            milestoneIndex={order.milestoneIndex}
            escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
            expectedChainId={getChainId()}
            counterpartyName={lawyerName}
            perspective="client"
          />
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-[13px] text-navy-900" : "text-[14px] font-medium text-navy-900"}>
        {value}
      </span>
    </div>
  );
}

function statusKind(s: string): "pending" | "info" | "success" | "neutral" | "error" {
  if (s === "REQUESTED") return "pending";
  if (s === "ACCEPTED") return "info";
  if (s === "COMPLETED") return "success";
  if (s === "DISPUTED") return "error";
  return "neutral";
}
