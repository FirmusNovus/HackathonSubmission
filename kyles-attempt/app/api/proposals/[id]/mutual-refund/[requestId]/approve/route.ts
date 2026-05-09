// =============================================================================
// /api/proposals/[id]/mutual-refund/[requestId]/approve — F6
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  approveRefundRequest,
  loadEngagementContext,
  refundRequestToWire,
} from "@/lib/chain/mutual-refund";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const Schema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "0x-prefixed 65-byte hex"),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

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

  try {
    const result = await approveRefundRequest({
      requestId,
      approver: {
        id: me.id,
        walletAddress: me.walletAddress,
        devSignerAddress: me.devSignerAddress,
        role: ctxResult.role,
      },
      signature: parsed.data.signature,
    });
    if ("error" in result) {
      const message =
        result.error === "InitiatorCannotApprove"
          ? "The initiator cannot also approve their own request."
          : result.error === "InvalidStatus"
            ? `Request is in status ${result.status}; only PENDING requests can be approved.`
            : "Request not found.";
      const status = result.error === "InitiatorCannotApprove" ? 403 : 409;
      return NextResponse.json({ error: { code: result.error, message } }, { status });
    }
    return NextResponse.json({ request: refundRequestToWire(result.request) });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }
}
