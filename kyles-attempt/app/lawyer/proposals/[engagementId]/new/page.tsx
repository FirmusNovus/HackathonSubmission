// =============================================================================
// /lawyer/proposals/[engagementId]/new
// -----------------------------------------------------------------------------
// Lawyer-side compose page for follow-up proposal offers (F4). Reuses the
// same line-item / deliverable shape as the consultation invoice editor —
// the form posts an EIP-712-signed envelope to /api/proposals which the
// client materialises later via /api/proposals/[id]/fund.
// =============================================================================

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { requireLawyerForExistingBooking } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { ProposalOfferForm } from "./proposal-form";

export const dynamic = "force-dynamic";

export default async function NewProposalOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await requireLawyerForExistingBooking();
  const { engagementId: rawEngagementId } = await params;
  const sp = await searchParams;
  const engagementId = Number(rawEngagementId);
  if (!Number.isInteger(engagementId) || engagementId <= 0) notFound();

  const engagement = await prisma.engagement.findUnique({
    where: { engagementId },
    include: {
      proposals: { orderBy: { proposalIndex: "asc" } },
    },
  });
  if (!engagement) notFound();
  if (engagement.lawyerUserId !== session.user.id) notFound();

  // Look up the booking that opened this engagement so the page can render
  // the client name + a "back to consultation" link. Bookings are 1:1 with
  // engagements via `Booking.engagementId`.
  const booking = await prisma.booking.findFirst({
    where: { engagementId },
    include: { client: { select: { id: true, name: true, walletAddress: true } } },
  });

  const hourlyRate = (
    await prisma.lawyerProfile.findUnique({
      where: { userId: session.user.id },
      select: { hourlyRateEUR: true },
    })
  )?.hourlyRateEUR;

  const consultationProposal = engagement.proposals.find((p) => p.proposalIndex === 0);

  return (
    <div className="min-h-screen bg-white-50 pb-24">
      <AppTopBar user={session.user} active="dashboard" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <Link
          href={
            sp.from
              ? `/lawyer/consultation/${encodeURIComponent(sp.from)}`
              : booking
                ? `/lawyer/consultation/${booking.id}`
                : "/lawyer/dashboard"
          }
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to consultation
        </Link>
        <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">
          {booking?.client?.name ? `Follow-up proposal for ${booking.client.name}.` : "Send a follow-up proposal."}
        </h1>
        <p className="mt-2 max-w-[640px] text-[15px] text-slate-500">
          Draft new line items and deliverables, sign the offer with your wallet, and the client gets a signed envelope
          to fund. Funds only move when they accept.
        </p>
        <div className="mt-2 text-[12px] text-slate-500">
          Engagement #{engagement.engagementId} · proposal[{engagement.proposalCount}] (next index)
          {consultationProposal && consultationProposal.state !== "RELEASED" && (
            <> · consultation: {consultationProposal.state}</>
          )}
        </div>

        <div className="mt-8">
          <ProposalOfferForm
            engagementId={engagement.engagementId}
            defaultRatePerHour={Number(hourlyRate ?? 0)}
            bookingId={booking?.id ?? null}
            clientName={booking?.client?.name ?? null}
          />
        </div>
      </main>
    </div>
  );
}
