import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Address } from "viem";
import { prisma } from "@/lib/db/client";
import { requireOperator } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { formatETH, truncateAddress } from "@/lib/utils/format";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { ResolveDisputeView } from "./resolve-dispute-view";

/**
 * Operator's view of a single open dispute. The kind is "booking" (the
 * consultation milestone, milestoneIndex 0) or "order" (a follow-up
 * milestone, 1+). Server side fetches the dispute target + the two
 * parties' submitted archives; the client view decrypts them in the
 * browser using the operator's local privkey, then collects the split
 * decision and submits resolveDispute(...) from the operator's wallet.
 */
export default async function OperatorDisputeDetailPage({
  params,
}: {
  params: Promise<{ kind: "booking" | "order"; id: string }>;
}) {
  const session = await requireOperator();
  const { kind, id } = await params;
  if (kind !== "booking" && kind !== "order") notFound();

  let dispute:
    | {
        kind: "booking";
        id: string;
        engagementIdOnChain: number;
        milestoneIndex: number;
        amountETH: number;
        clientName: string;
        lawyerName: string;
        clientWallet: Address;
        lawyerWallet: Address;
        practiceArea: string;
        caseDescription: string;
        openedBy: string | null;
      }
    | {
        kind: "order";
        id: string;
        engagementIdOnChain: number;
        milestoneIndex: number;
        amountETH: number;
        clientName: string;
        lawyerName: string;
        clientWallet: Address;
        lawyerWallet: Address;
        description: string;
        openedBy: string | null;
      };

  if (kind === "booking") {
    const b = await prisma.booking.findUnique({
      where: { id },
      include: {
        client: true,
        lawyerProfile: { include: { user: true } },
        engagement: true,
      },
    });
    if (!b || b.status !== "DISPUTED" || !b.engagement) notFound();
    dispute = {
      kind: "booking",
      id: b.id,
      engagementIdOnChain: b.engagement.engagementIdOnChain,
      milestoneIndex: 0,
      amountETH: Number(b.consultationFeeEUR),
      clientName: b.client.name ?? truncateAddress(b.client.walletAddress),
      lawyerName: b.lawyerProfile.user.name ?? "Lawyer",
      clientWallet: b.client.walletAddress as Address,
      lawyerWallet: b.lawyerProfile.user.walletAddress as Address,
      practiceArea: b.practiceArea,
      caseDescription: b.caseDescription,
      openedBy: b.disputeOpenedBy,
    };
  } else {
    const o = await prisma.order.findUnique({
      where: { id },
      include: {
        engagement: { include: { client: true, lawyerProfile: { include: { user: true } } } },
      },
    });
    if (!o || o.status !== "DISPUTED" || o.milestoneIndex === null) notFound();
    dispute = {
      kind: "order",
      id: o.id,
      engagementIdOnChain: o.engagement.engagementIdOnChain,
      milestoneIndex: o.milestoneIndex,
      amountETH: Number(o.amountETH),
      clientName:
        o.engagement.client.name ?? truncateAddress(o.engagement.client.walletAddress),
      lawyerName: o.engagement.lawyerProfile.user.name ?? "Lawyer",
      clientWallet: o.engagement.client.walletAddress as Address,
      lawyerWallet: o.engagement.lawyerProfile.user.walletAddress as Address,
      description: o.description,
      openedBy: o.disputeOpenedBy,
    };
  }

  const archiveWhere = kind === "booking" ? { bookingId: id } : { orderId: id };
  const archives = await prisma.disputeArchive.findMany({
    where: archiveWhere,
    include: { submittedBy: { select: { id: true, name: true, walletAddress: true, role: true } } },
    orderBy: { submittedAt: "asc" },
  });

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="dashboard" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Operator dashboard
        </Link>

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-3xl text-navy-900">
            Dispute · {dispute.clientName} ↔ {dispute.lawyerName}
          </h1>
          <Badge kind="error">disputed</Badge>
        </div>
        <p className="mt-2 text-[13px] text-slate-500">
          {dispute.kind === "booking"
            ? `Consultation (${dispute.practiceArea}) · ${formatETH(dispute.amountETH)} parked`
            : `Follow-up order · ${formatETH(dispute.amountETH)} parked`}
          {dispute.openedBy && ` · opened by ${dispute.openedBy.toLowerCase()}`}
        </p>

        <ResolveDisputeView
          kind={dispute.kind}
          id={dispute.id}
          engagementIdOnChain={dispute.engagementIdOnChain}
          milestoneIndex={dispute.milestoneIndex}
          amountETH={dispute.amountETH}
          clientName={dispute.clientName}
          lawyerName={dispute.lawyerName}
          clientWallet={dispute.clientWallet}
          lawyerWallet={dispute.lawyerWallet}
          caseSummary={
            dispute.kind === "booking" ? dispute.caseDescription : dispute.description
          }
          archives={archives.map((a) => ({
            id: a.id,
            submittedAt: a.submittedAt.toISOString(),
            submitterUserId: a.submittedById,
            submitterName: a.submittedBy.name ?? truncateAddress(a.submittedBy.walletAddress),
            submitterRole: a.submittedBy.role as "CLIENT" | "LAWYER",
            submitterEncryptionPublicKey: a.submitterEncryptionPublicKey,
            encryptedBundle: a.encryptedBundle,
          }))}
          escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
          expectedChainId={getChainId()}
        />
      </main>
    </div>
  );
}
