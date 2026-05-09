// =============================================================================
// /api/operator/disputes/[engagementId]/[proposalIndex] — F7
// -----------------------------------------------------------------------------
// Operator-only single-dispute detail. Returns the engagement's full proposal
// history, transcript-root timeline, and (when proposal[0]) the booking shell
// case description + line items + deliverables. The list route returns a
// summary; this route returns everything the resolve form needs.
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireOperator } from "@/lib/auth/session";
import { anonymousClientId } from "@/lib/utils/anonymize";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ engagementId: string; proposalIndex: string }> },
) {
  await requireOperator();

  const { engagementId: engIdRaw, proposalIndex: propIdxRaw } = await ctx.params;
  const engagementId = Number(engIdRaw);
  const proposalIndex = Number(propIdxRaw);
  if (!Number.isInteger(engagementId) || engagementId < 1) {
    return NextResponse.json({ error: "Invalid engagementId" }, { status: 400 });
  }
  if (!Number.isInteger(proposalIndex) || proposalIndex < 0) {
    return NextResponse.json({ error: "Invalid proposalIndex" }, { status: 400 });
  }

  const engagement = await prisma.engagement.findUnique({
    where: { engagementId },
    include: { proposals: { orderBy: { proposalIndex: "asc" } } },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }

  const targetProposal = engagement.proposals.find((p) => p.proposalIndex === proposalIndex);
  if (!targetProposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const [client, lawyer, booking, transcriptHistory] = await Promise.all([
    prisma.user.findUnique({ where: { id: engagement.clientUserId } }),
    prisma.user.findUnique({
      where: { id: engagement.lawyerUserId },
      include: { lawyerProfile: true },
    }),
    prisma.booking.findFirst({ where: { engagementId } }),
    prisma.transcriptRootHistory.findMany({
      where: { engagementId },
      orderBy: { blockNumber: "asc" },
    }),
  ]);

  const lawyerProfile = lawyer?.lawyerProfile ?? null;
  const isConsultationProposal = booking != null && proposalIndex === booking.proposalIndex;

  return NextResponse.json({
    dispute: {
      engagementId,
      proposalIndex,
      amountWei: targetProposal.amountWei,
      amountEUR: Number(targetProposal.amountWei) / 100,
      proposalState: targetProposal.state,
      deliveredAt: targetProposal.deliveredAt ? targetProposal.deliveredAt.toISOString() : null,
      disputedAt: targetProposal.updatedAt.toISOString(),
      disputeTxHash: targetProposal.disputeTxHash,
      trigger: targetProposal.deliveredAt != null ? "lawyer_escalation" : "client_dispute",
    },
    engagement: {
      engagementId: engagement.engagementId,
      state: engagement.state,
      transcriptRoot: engagement.transcriptRoot,
      proposalCount: engagement.proposalCount,
      openedAt: engagement.openedAt.toISOString(),
      closedAt: engagement.closedAt ? engagement.closedAt.toISOString() : null,
    },
    proposals: engagement.proposals.map((p) => ({
      proposalIndex: p.proposalIndex,
      state: p.state,
      amountWei: p.amountWei,
      amountEUR: Number(p.amountWei) / 100,
      deliveredAt: p.deliveredAt ? p.deliveredAt.toISOString() : null,
      amountToLawyerWei: p.amountToLawyerWei,
      amountToClientWei: p.amountToClientWei,
    })),
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
          verificationStatus: lawyerProfile?.verificationStatus ?? null,
        }
      : null,
    booking:
      booking && isConsultationProposal
        ? {
            id: booking.id,
            caseDescription: booking.caseDescription,
            practiceArea: booking.practiceArea,
            status: booking.status,
            scheduledAt: booking.scheduledAt.toISOString(),
            durationMinutes: booking.durationMinutes,
            consultationFeeEUR: Number(booking.consultationFeeEUR),
            lineItems: booking.lineItems,
            deliverables: booking.deliverables,
          }
        : null,
    transcriptHistory: transcriptHistory.map((t) => ({
      root: t.root,
      blockNumber: t.blockNumber,
      anchoredAt: t.anchoredAt.toISOString(),
    })),
  });
}
