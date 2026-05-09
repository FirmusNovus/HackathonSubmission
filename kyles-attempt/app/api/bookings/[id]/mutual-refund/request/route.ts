// =============================================================================
// /api/bookings/[id]/mutual-refund/request — F6
// -----------------------------------------------------------------------------
// Initiator (either party) signs the MutualRefundAuthorization typed-data
// and creates a fresh MutualRefundRequest row. The signature is verified
// IMMEDIATELY (real EIP-712) — a forged sig is rejected at request-creation
// time, not deferred to submit.
//
// Body: { proposalIndex?: number, signature: string }
//   proposalIndex defaults to booking.proposalIndex (the consultation).
//
// Returns 201 + { request } (wire shape) on success.
// 409 if an active request already exists for this proposal.
// 422 InvalidRefundSignature on a bad signature.
// 409 InvalidProposalState if the proposal is not Funded.
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
  proposalIndex: z.number().int().nonnegative().optional(),
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

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.engagementId == null) {
    return NextResponse.json(
      { error: { code: "BookingNotOnChain", message: "Booking has no engagement — cannot refund." } },
      { status: 409 },
    );
  }
  const isClient = booking.clientId === me.id;
  const isLawyer = booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden — not a party to this booking." }, { status: 403 });
  }

  const proposalIndex = parsed.data.proposalIndex ?? booking.proposalIndex;
  const ctxResult = await loadEngagementContext({
    engagementId: booking.engagementId,
    proposalIndex,
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
      engagementId: booking.engagementId,
      proposalIndex,
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
