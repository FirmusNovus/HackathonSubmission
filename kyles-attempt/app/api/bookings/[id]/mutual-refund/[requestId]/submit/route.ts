// =============================================================================
// /api/bookings/[id]/mutual-refund/[requestId]/submit — F6
// -----------------------------------------------------------------------------
// Either party submits the now-fully-signed refund authorisation to the
// chain. Status must be SIGNED_BOTH (server-side guard against malicious
// premature submits). On success, status flips to SUBMITTED and the chain
// layer flips Proposal[i] to Refunded.
//
// Booking-shell flip: if the refunded proposal IS the consultation
// (proposalIndex === booking.proposalIndex, i.e. proposal[0]), the booking
// shell flips to CANCELLED via the bridge. Follow-up refunds leave the
// booking row alone.
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { mutualRefundForBooking } from "@/lib/chain/booking-bridge";
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

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.engagementId == null) {
    return NextResponse.json({ error: "Booking has no engagement." }, { status: 409 });
  }
  const isClient = booking.clientId === me.id;
  const isLawyer = booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const req = await prisma.mutualRefundRequest.findUnique({ where: { id: requestId } });
  if (!req || req.engagementId !== booking.engagementId) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const ctxResult = await loadEngagementContext({
    engagementId: booking.engagementId,
    proposalIndex: req.proposalIndex,
    callerUserId: me.id,
  });
  if ("error" in ctxResult) {
    return NextResponse.json(
      { error: { code: ctxResult.error, message: ctxResult.error } },
      { status: ctxResult.error === "NotEngagementParty" ? 403 : 404 },
    );
  }

  // Server-side guard — only SIGNED_BOTH may be submitted. The chain layer
  // would reject a one-sig-only submit too (recovery would fail on the
  // missing sig), but this surfaces a clean 409 instead of a 422.
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

  // Drive the chain through the bridge so the booking shell flips to
  // CANCELLED iff this is proposal[0]. Real EIP-712 verification happens
  // inside `mutualRefundProposal`.
  let txHash: string;
  try {
    const result = await mutualRefundForBooking(
      {
        id: booking.id,
        engagementId: booking.engagementId,
        proposalIndex: booking.proposalIndex,
      },
      {
        fromAddress: me.walletAddress,
        clientSig: ready.request.clientSig!,
        lawyerSig: ready.request.lawyerSig!,
        proposalIndex: req.proposalIndex,
      },
    );
    txHash = result.txHash;
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }

  const updated = await markRequestSubmitted({ requestId, txHash });
  const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
  return NextResponse.json({
    request: refundRequestToWire(updated),
    booking: fresh,
    txHash,
  });
}
