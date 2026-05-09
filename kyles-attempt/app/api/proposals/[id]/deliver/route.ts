// =============================================================================
// /api/proposals/[id]/deliver
// -----------------------------------------------------------------------------
// Lawyer marks a follow-up proposal (materialised from a ProposalOffer) as
// delivered. The offer must already be funded. Drives the chain via the
// `markDeliveredForProposal` bridge helper, which calls the same
// `markDelivered` surface used by proposal[0] — just with a non-zero index.
// =============================================================================

import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { markDeliveredForProposal } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const offer = await prisma.proposalOffer.findUnique({ where: { id } });
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  if (offer.consumedProposalIndex == null) {
    return NextResponse.json(
      { error: { code: "OfferNotFunded", message: "This offer has not been funded yet." } },
      { status: 409 },
    );
  }
  const engagement = await prisma.engagement.findUnique({ where: { engagementId: offer.engagementId } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.lawyerUserId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await markDeliveredForProposal({
      engagementId: offer.engagementId,
      proposalIndex: offer.consumedProposalIndex,
      from: me.walletAddress,
    });
    return NextResponse.json({
      proposalIndex: offer.consumedProposalIndex,
      deliveredAt: result.deliveredAt.toISOString(),
      txHash: result.txHash,
    });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }
}
