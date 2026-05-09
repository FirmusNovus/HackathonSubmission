// =============================================================================
// /api/bookings/[id]/mutual-refund — F6
// -----------------------------------------------------------------------------
// GET: list every MutualRefundRequest attached to this booking's engagement,
// regardless of proposalIndex. Used by the consultation room rail to render
// pending banners + the SIGNED_BOTH "submit" affordance.
//
// The room polls this every few seconds; we keep the response small (only
// the wire shape from `refundRequestToWire`, which omits the raw signatures
// — those are server-only secrets that must not leak to the counterparty's
// browser before the chain call burns them).
// =============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { refundRequestToWire } from "@/lib/chain/mutual-refund";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isClient = booking.clientId === me.id;
  const isLawyer = booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.engagementId == null) {
    return NextResponse.json({ requests: [] });
  }

  const requests = await prisma.mutualRefundRequest.findMany({
    where: { engagementId: booking.engagementId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests: requests.map(refundRequestToWire) });
}
