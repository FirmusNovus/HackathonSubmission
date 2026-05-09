// =============================================================================
// /api/bookings/[id]/mutual-refund/[requestId]/reject — F6
// -----------------------------------------------------------------------------
// Either party rejects an in-flight refund request. Idempotent on already-
// REJECTED rows. SUBMITTED rows are terminal and cannot be rejected.
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
