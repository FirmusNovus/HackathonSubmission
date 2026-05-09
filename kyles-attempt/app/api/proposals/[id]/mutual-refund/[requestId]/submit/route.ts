// =============================================================================
// /api/proposals/[id]/mutual-refund/[requestId]/submit — F6
// -----------------------------------------------------------------------------
// Submits a SIGNED_BOTH refund authorisation for a follow-up proposal. Goes
// through `mutualRefundForProposal` (no booking-shell flip) since follow-up
// refunds don't touch the consultation booking row.
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { mutualRefundForProposal } from "@/lib/chain/booking-bridge";
import {
  loadEngagementContext,
  loadSubmittableRequest,
  markRequestSubmitted,
  refundRequestToWire,
} from "@/lib/chain/mutual-refund";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

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

  const ready = await loadSubmittableRequest(requestId);
  if ("error" in ready) {
    const message =
      ready.error === "InvalidStatus"
        ? `Request is in status ${ready.status}; only SIGNED_BOTH requests can be submitted.`
        : ready.error === "MissingSigs"
          ? "Both signatures are required before submitting."
          : "Request not found.";
    return NextResponse.json({ error: { code: ready.error, message } }, { status: 409 });
  }

  let txHash: string;
  try {
    const result = await mutualRefundForProposal({
      engagementId: offer.engagementId,
      proposalIndex: offer.consumedProposalIndex,
      clientSig: ready.request.clientSig!,
      lawyerSig: ready.request.lawyerSig!,
      from: me.walletAddress,
    });
    txHash = result.txHash;
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }

  const updated = await markRequestSubmitted({ requestId, txHash });
  return NextResponse.json({
    request: refundRequestToWire(updated),
    txHash,
  });
}
