import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare, Video } from "lucide-react";
import type { Address } from "viem";
import { prisma } from "@/lib/db/client";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { OrderCard } from "@/components/firmus/order-card";
import { OrderActionPanel } from "@/components/firmus/order-action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/db/enums";
import { formatScheduled } from "@/lib/utils/format";
import { isJoinableNow, joinabilityReason } from "@/lib/utils/booking";
import { getAddresses, getChainId } from "@/lib/chain/addresses";

export default async function ClientCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireClient();
  const { id } = await params;
  const booking = await prisma.booking.findFirst({
    where: { id, clientId: session.user.id },
    include: {
      client: true,
      lawyerProfile: { include: { user: true } },
      engagement: true,
      conversation: true,
    },
  });
  if (!booking) notFound();

  const selfArchive =
    booking.status === "DISPUTED"
      ? await prisma.disputeArchive.findFirst({
          where: { bookingId: booking.id, submittedById: session.user.id },
          select: { id: true },
        })
      : null;

  const joinable = isJoinableNow(booking.status, booking.scheduledAt, booking.durationMinutes);
  const reason = joinabilityReason(booking.status, booking.scheduledAt);

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="cases" />
      <main className="mx-auto max-w-[900px] px-6 py-10 lg:px-8">
        <Link
          href="/client/cases"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All cases
        </Link>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-3xl text-navy-900">
              {booking.lawyerProfile.user.name}
            </h1>
            <p className="mt-1 text-[14px] text-slate-500">
              {booking.practiceArea} · {booking.lawyerProfile.city} ·{" "}
              {formatScheduled(booking.scheduledAt)} · {booking.durationMinutes} min
            </p>
            <p className="mt-1 text-[12px] text-slate-500">{reason}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge kind={booking.status === "ACCEPTED" ? "info" : booking.status === "COMPLETED" ? "success" : "pending"}>
              {booking.status.toLowerCase()}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <Link href={`/client/messages?booking=${booking.id}`}>
                <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Messages
              </Link>
            </Button>
            {booking.engagement && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/client/engagements/${booking.engagement.id}`}>Engagement</Link>
              </Button>
            )}
            {joinable && (
              <Button asChild size="sm">
                <Link href={`/client/consultation/${booking.id}`}>
                  <Video className="h-3.5 w-3.5" aria-hidden /> Join consultation
                </Link>
              </Button>
            )}
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Case description</div>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-navy-900">{booking.caseDescription}</p>
        </section>

        <div className="mt-6 space-y-5">
          <OrderActionPanel
            bookingId={booking.id}
            lawyerName={booking.lawyerProfile.user.name ?? "Your lawyer"}
            totalEUR={Number(booking.consultationFeeEUR)}
            platformFeeEUR={Number(booking.platformFeeEUR)}
            status={booking.status as BookingStatus}
            clientAcceptedAt={booking.clientAcceptedAt?.toISOString() ?? null}
            lawyerAcceptedAt={booking.lawyerAcceptedAt?.toISOString() ?? null}
            escrowTxHash={booking.escrowTxHash}
            escrowReleaseHash={booking.escrowReleaseHash}
            engagementIdOnChain={booking.engagement?.engagementIdOnChain ?? null}
            clientRefundSigned={Boolean(booking.clientRefundSignature)}
            lawyerRefundSigned={Boolean(booking.lawyerRefundSignature)}
            escrowRefundHash={booking.escrowRefundHash}
            refundProposedBy={(booking.refundProposedBy ?? null) as "CLIENT" | "LAWYER" | null}
            lawyerWalletAddress={booking.lawyerProfile.user.walletAddress as Address}
            escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
            expectedChainId={getChainId()}
            conversationId={booking.conversation?.id ?? null}
            counterpartyUserId={booking.lawyerProfile.user.id}
            selfArchiveSubmitted={Boolean(selfArchive)}
            disputeResolveTxHash={booking.disputeResolveTxHash}
            disputeAmountToLawyer={
              booking.disputeAmountToLawyer != null ? Number(booking.disputeAmountToLawyer) : null
            }
            disputeAmountToClient={
              booking.disputeAmountToClient != null ? Number(booking.disputeAmountToClient) : null
            }
          />
          <OrderCard
            bookingId={booking.id}
            durationMinutes={booking.durationMinutes}
            totalEUR={Number(booking.consultationFeeEUR)}
            clientAcceptedAt={booking.clientAcceptedAt?.toISOString() ?? null}
            lawyerAcceptedAt={booking.lawyerAcceptedAt?.toISOString() ?? null}
            funded={booking.engagement?.engagementIdOnChain != null}
            clientName={booking.client.name ?? "You"}
            lawyerName={booking.lawyerProfile.user.name ?? "Your lawyer"}
          />
        </div>
      </main>
    </div>
  );
}
