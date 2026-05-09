// =============================================================================
// /api/proposals/[id]/mutual-refund — F6 (proposal-id keyed)
// -----------------------------------------------------------------------------
// GET: list every MutualRefundRequest attached to the engagement+proposalIndex
// referenced by this ProposalOffer. Mirror of /api/bookings/[id]/mutual-refund
// for follow-up proposals (where there's no booking shell to address through).
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { refundRequestToWire } from "@/lib/chain/mutual-refund";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const offer = await prisma.proposalOffer.findUnique({ where: { id } });
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  if (offer.consumedProposalIndex == null) {
    return NextResponse.json({ requests: [] });
  }
  const engagement = await prisma.engagement.findUnique({ where: { engagementId: offer.engagementId } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.clientUserId !== me.id && engagement.lawyerUserId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const requests = await prisma.mutualRefundRequest.findMany({
    where: { engagementId: offer.engagementId, proposalIndex: offer.consumedProposalIndex },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests: requests.map(refundRequestToWire) });
}
