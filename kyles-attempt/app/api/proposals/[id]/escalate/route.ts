// =============================================================================
// /api/proposals/[id]/escalate — F5
// -----------------------------------------------------------------------------
// Lawyer escalates a Delivered follow-up proposal after the 30-day cooldown.
// Mirrors `/api/bookings/[id]/escalate` but for proposalIndex>0. CooldownNotElapsed
// surfaces as 425 with an `unlockAt` field for a precise UI countdown.
// =============================================================================

import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { escalateForProposal } from "@/lib/chain/booking-bridge";
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
    const result = await escalateForProposal({
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
      // CooldownNotElapsed → 425 with `unlockAt` in the body. The UI mirrors
      // the booking-level escalate route's handling.
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }
}
