// =============================================================================
// /api/operator/disputes — F7
// -----------------------------------------------------------------------------
// Operator-only listing of every Proposal currently in DISPUTED state. Mirrors
// A's parallel route at `apps/platform/app/api/operator/disputes/route.ts` —
// the operator is the arbiter for the demo scope (see Constitution v2.0.0
// session 2026-05-08 in A's tree).
//
// Returns a flat array of disputes with the engagement + lawyer + client
// (anonymized) info required by the operator dashboard. Booking shell info is
// expanded when a 1:1 booking exists (proposal[0] disputes); follow-up
// proposal disputes have null `booking`.
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireOperator } from "@/lib/auth/session";
import { anonymousClientId } from "@/lib/utils/anonymize";

export async function GET() {
  await requireOperator();

  const disputed = await prisma.proposal.findMany({
    where: { state: "DISPUTED" },
    orderBy: { updatedAt: "desc" },
  });

  if (disputed.length === 0) {
    return NextResponse.json({ disputes: [] });
  }

  const engagementIds = Array.from(new Set(disputed.map((p) => p.engagementId)));
  const engagements = await prisma.engagement.findMany({
    where: { engagementId: { in: engagementIds } },
  });
  const engagementById = new Map(engagements.map((e) => [e.engagementId, e]));

  const userIds = Array.from(
    new Set(engagements.flatMap((e) => [e.clientUserId, e.lawyerUserId])),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    include: { lawyerProfile: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const bookings = await prisma.booking.findMany({
    where: { engagementId: { in: engagementIds } },
  });
  const bookingByEngagement = new Map(bookings.map((b) => [b.engagementId, b]));

  const disputes = disputed.map((p) => {
    const engagement = engagementById.get(p.engagementId);
    const client = engagement ? userById.get(engagement.clientUserId) : null;
    const lawyer = engagement ? userById.get(engagement.lawyerUserId) : null;
    const lawyerProfile = lawyer?.lawyerProfile;
    const booking = bookingByEngagement.get(p.engagementId);
    const isConsultationProposal = booking != null && p.proposalIndex === booking.proposalIndex;

    // EUR mirrors EUR cents stored as wei in the mock chain. F4 swaps this
    // for a real on-chain stablecoin decimals() conversion.
    const amountEUR = Number(p.amountWei) / 100;

    return {
      engagementId: p.engagementId,
      proposalIndex: p.proposalIndex,
      amountWei: p.amountWei,
      amountEUR,
      deliveredAt: p.deliveredAt ? p.deliveredAt.toISOString() : null,
      disputedAt: p.updatedAt.toISOString(),
      transcriptRoot: engagement?.transcriptRoot ?? null,
      client: client
        ? {
            id: client.id,
            anonymousId: anonymousClientId(client.walletAddress),
            walletAddress: client.walletAddress,
          }
        : null,
      lawyer: lawyer
        ? {
            id: lawyer.id,
            name: lawyer.name,
            walletAddress: lawyer.walletAddress,
            barRegistrationNum: lawyerProfile?.barRegistrationNum ?? null,
            barJurisdiction: lawyerProfile?.barJurisdiction ?? null,
          }
        : null,
      booking:
        booking && isConsultationProposal
          ? {
              id: booking.id,
              caseDescription: booking.caseDescription,
              practiceArea: booking.practiceArea,
              status: booking.status,
            }
          : null,
      // Heuristic: a delivered_at timestamp implies the lawyer escalation
      // path (markDelivered must have run first to start the cooldown). No
      // delivered_at + DISPUTED => client-initiated dispute.
      trigger: p.deliveredAt != null ? "lawyer_escalation" : "client_dispute",
    };
  });

  return NextResponse.json({ disputes });
}
