// =============================================================================
// /api/proposals/[id]/mutual-refund/[requestId]/reject — F6
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  loadEngagementContext,
  refundRequestToWire,
  rejectRefundRequest,
} from "@/lib/chain/mutual-refund";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const offer = await prisma.proposalOffer.findUnique({ where: { id } });
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  if (offer.consumedProposalIndex == null) {
    return NextResponse.json({ error: "Offer not funded" }, { status: 409 });
  }

  const req = await prisma.mutualRefundRequest.findUnique({ where: { id: requestId } });
  if (!req || req.engagementId !== offer.engagementId || req.proposalIndex !== offer.consumedProposalIndex) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const ctxResult = await loadEngagementContext({
    engagementId: offer.engagementId,
    proposalIndex: offer.consumedProposalIndex,
    callerUserId: me.id,
  });
  if ("error" in ctxResult) {
    return NextResponse.json(
      { error: { code: ctxResult.error, message: ctxResult.error } },
      { status: ctxResult.error === "NotEngagementParty" ? 403 : 404 },
    );
  }

  const result = await rejectRefundRequest({
    requestId,
    rejecterUserId: me.id,
    rejecterRole: ctxResult.role,
  });
  if ("error" in result) {
    const status = result.error === "AlreadySubmitted" ? 409 : 404;
    const message =
      result.error === "AlreadySubmitted"
        ? "Cannot reject a request that has already been submitted to chain."
        : "Request not found.";
    return NextResponse.json({ error: { code: result.error, message } }, { status });
  }
  return NextResponse.json({ request: refundRequestToWire(result.request) });
}
