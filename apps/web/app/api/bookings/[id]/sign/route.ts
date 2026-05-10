import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishBookingChanged } from "@/lib/events/realtime";

/**
 * Client signature on a lawyer-initiated order. Symmetric to
 * `/api/bookings/[id]/accept` (the lawyer's signature). Sets
 * `clientAcceptedAt`; the booking stays in REQUESTED until the on-chain
 * funding tx confirms (see /api/bookings/[id]/funded). Phase 6 moved the
 * actual escrow funding to the client's wallet — only the client can call
 * `openEngagementAndFundFirstMilestone` (msg.sender == client gate), so the
 * server cannot fund on their behalf.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.clientAcceptedAt) {
    return NextResponse.json({ booking }); // idempotent — already signed
  }
  const updated = await prisma.booking.update({
    where: { id },
    data: { clientAcceptedAt: new Date() },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
