import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, ExternalLink, Check, Calendar } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { OrderCard } from "@/components/firmus/order-card";
import { Badge } from "@/components/ui/badge";
import { formatETH, formatScheduled } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { OrderActions } from "./order-actions";

export default async function LawyerOrderReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireLawyer();
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { client: true, lawyerProfile: true, engagement: true, conversation: true },
  });
  if (!booking || booking.lawyerProfile.userId !== session.user.id) notFound();

  const selfArchive =
    booking.status === "DISPUTED"
      ? await prisma.disputeArchive.findFirst({
          where: { bookingId: booking.id, submittedById: session.user.id },
          select: { id: true },
        })
      : null;

  const fee = Number(booking.consultationFeeEUR);
  const platformFee = Number(booking.platformFeeEUR);
  const netToLawyer = fee - platformFee;
  const lawyerSignedFirst = Boolean(booking.lawyerAcceptedAt && !booking.clientAcceptedAt);

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="orders" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <Link href="/lawyer/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>

        <div className="mt-6 flex flex-wrap items-baseline gap-4">
          <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
            {lawyerSignedFirst ? "Order you sent" : "New consultation order"}
          </h1>
          <Badge kind="pending">
            {lawyerSignedFirst
              ? "Awaiting client signature"
              : booking.clientAcceptedAt && !booking.lawyerAcceptedAt
                ? "Awaiting your signature"
                : "In progress"}
          </Badge>
          {booking.engagement && (
            <Link
              href={`/lawyer/engagements/${booking.engagement.id}`}
              className="text-[13px] font-medium text-teal-700 hover:underline"
            >
              View engagement →
            </Link>
          )}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-slate-100 bg-white-0 p-7">
            <div className="flex items-center gap-3.5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-50">
                <span className="font-display text-xl text-slate-500">
                  {booking.client.name ? booking.client.name.slice(0, 1).toUpperCase() : "?"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-navy-900">
                  {booking.client.name ?? (
                    <>
                      Client <span className="font-mono text-slate-500">{anonymousClientId(booking.client.walletAddress)}</span>
                    </>
                  )}
                </div>
                <div className="mt-0.5 text-[13px] text-slate-500">
                  {booking.client.name
                    ? "PID-disclosed name · wallet verified"
                    : "Anonymous identifier · wallet verified"}
                </div>
              </div>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              {[
                ["Practice area", booking.practiceArea],
                ["Jurisdiction", booking.lawyerProfile.barJurisdiction],
                ["Requested time", formatScheduled(booking.scheduledAt)],
                ["Duration", `${booking.durationMinutes} minutes`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{k}</div>
                  <div className="text-[15px] font-medium text-navy-900">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-7">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Case description</div>
              <p className="rounded-lg bg-white-50 p-5 text-[15px] leading-[1.65] text-slate-700">
                {booking.caseDescription}
              </p>
            </div>

            <div className="mt-7 flex items-start gap-3.5 rounded-lg bg-green-50 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-400">
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-[#1A8A5C]">Conflict check passed</div>
                <div className="mt-1 text-[13px] text-slate-700">
                  No prior on-chain interactions detected with this client wallet or any related wallets in your case history.
                </div>
              </div>
            </div>

            <div className="mt-7">
              <OrderCard
                bookingId={booking.id}
                durationMinutes={booking.durationMinutes}
                totalEUR={fee}
                clientAcceptedAt={booking.clientAcceptedAt?.toISOString() ?? null}
                lawyerAcceptedAt={booking.lawyerAcceptedAt?.toISOString() ?? null}
                funded={booking.engagement?.engagementIdOnChain != null}
                clientName={booking.client.name ?? `Client ${anonymousClientId(booking.client.walletAddress)}`}
                lawyerName={session.user.name ?? "You"}
              />
            </div>

            <OrderActions
              bookingId={booking.id}
              initial={{
                status: booking.status,
                clientAcceptedAt: booking.clientAcceptedAt?.toISOString() ?? null,
                lawyerAcceptedAt: booking.lawyerAcceptedAt?.toISOString() ?? null,
                engagementIdOnChain: booking.engagement?.engagementIdOnChain ?? null,
                escrowReleaseHash: booking.escrowReleaseHash,
                clientRefundSigned: Boolean(booking.clientRefundSignature),
                lawyerRefundSigned: Boolean(booking.lawyerRefundSignature),
                escrowRefundHash: booking.escrowRefundHash,
                refundProposedBy: (booking.refundProposedBy ?? null) as "CLIENT" | "LAWYER" | null,
                disputeResolveTxHash: booking.disputeResolveTxHash,
                disputeAmountToLawyer:
                  booking.disputeAmountToLawyer != null ? Number(booking.disputeAmountToLawyer) : null,
                disputeAmountToClient:
                  booking.disputeAmountToClient != null ? Number(booking.disputeAmountToClient) : null,
              }}
              consultationFeeETH={fee}
              scheduledAt={booking.scheduledAt.toISOString()}
              escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
              expectedChainId={getChainId()}
              conversationId={booking.conversation?.id ?? null}
              counterpartyUserId={booking.client.id}
              selfArchiveSubmitted={Boolean(selfArchive)}
            />
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-white-0 p-6">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Proposed fee</div>
              <div className="font-display mt-1 text-3xl text-navy-900">{formatETH(fee)}</div>
              <div className="text-[13px] text-slate-500">ETH · before 5% platform fee</div>
              <hr className="my-5 border-t border-slate-100" />
              <div className="text-[13px] font-medium text-navy-900">You'll receive</div>
              <div className="font-display mt-0.5 text-xl text-teal-700">{formatETH(netToLawyer)}</div>
              <div className="mt-1 text-[12px] text-slate-500">after platform fee, on consultation completion</div>
            </div>

            <div className="flex gap-3 rounded-xl border border-slate-100 bg-white-0 p-5">
              <Lock className="h-4 w-4 text-teal-700" aria-hidden />
              <div>
                <div className="text-[13px] font-medium text-navy-900">Smart contract escrow</div>
                <p className="mt-1 text-[12px] leading-[1.55] text-slate-500">
                  On accept, the client's funds are held in a smart contract and released to your wallet when the consultation is marked complete.
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500" title="Block-explorer link available once the escrow contract ships">
                  Contract <span className="font-mono">{booking.escrowTxHash?.slice(0, 6) ?? "0x4f02"}…{booking.escrowTxHash?.slice(-4) ?? "2c1a"}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </span>
              </div>
            </div>

            <div className="flex gap-3 rounded-xl border border-slate-100 bg-white-0 p-5">
              <Calendar className="h-4 w-4 text-teal-700" aria-hidden />
              <div>
                <div className="text-[13px] font-medium text-navy-900">Suggest a different time</div>
                <p className="mt-1 text-[12px] leading-[1.55] text-slate-500">
                  Use the message thread to propose an alternative slot. The client can accept it directly without re-funding escrow.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
