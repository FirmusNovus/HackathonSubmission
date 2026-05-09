// =============================================================================
// /api/proposals/[id]/mutual-refund/request — F6 (proposal-id keyed)
// -----------------------------------------------------------------------------
// Initiator (either party) signs the typed-data and creates a refund request
// for the funded follow-up proposal addressed by ProposalOffer.id.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  createRefundRequest,
  loadEngagementContext,
  refundRequestToWire,
} from "@/lib/chain/mutual-refund";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const Schema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "0x-prefixed 65-byte hex"),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
    return NextResponse.json(
      { error: { code: "OfferNotFunded", message: "This offer has not been funded yet." } },
      { status: 409 },
    );
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
    const result = await createRefundRequest({
      engagementId: offer.engagementId,
      proposalIndex: offer.consumedProposalIndex,
      initiator: {
        id: me.id,
        walletAddress: me.walletAddress,
        devSignerAddress: me.devSignerAddress,
        role: ctxResult.role,
      },
      signature: parsed.data.signature,
    });
    if ("error" in result) {
      return NextResponse.json(
        {
          error: { code: result.error, message: "An active refund request already exists." },
          request: refundRequestToWire(result.request),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ request: refundRequestToWire(result.request) }, { status: 201 });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }
}
