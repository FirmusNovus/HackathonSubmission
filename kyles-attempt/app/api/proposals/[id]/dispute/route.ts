// =============================================================================
// /api/proposals/[id]/dispute — F5
// -----------------------------------------------------------------------------
// Client disputes a funded follow-up proposal addressed by ProposalOffer id.
// Mirrors `/api/bookings/[id]/dispute` but for proposalIndex>0. The booking
// shell is unaffected; only the on-chain Proposal row flips to Disputed.
// =============================================================================

import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { disputeForProposal } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
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
  if (engagement.clientUserId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await disputeForProposal({
      engagementId: offer.engagementId,
      proposalIndex: offer.consumedProposalIndex,
      from: me.walletAddress,
      transcriptRoot: engagement.transcriptRoot,
    });
    return NextResponse.json({
      proposalIndex: offer.consumedProposalIndex,
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
