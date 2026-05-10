import { NextResponse } from "next/server";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishBookingChanged } from "@/lib/events/realtime";

/**
 * Mark a booking COMPLETED. Phase 6 only updates the DB — the actual
 * on-chain `releaseMilestone` call is client-signed (msg.sender == client)
 * and lands in Phase 7 alongside a /api/bookings/[id]/released endpoint
 * that verifies the release tx and sets `escrowReleaseHash`.
 *
 * Until then, COMPLETED bookings render as the "free" / "Closed" phase
 * (escrowReleaseHash null) — visibly inconsistent with the in-escrow state
 * the booking had a moment earlier, but the real fix belongs to Phase 7,
 * not a stub here.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
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
  if (!isClient && !isLawyer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updated = await prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.COMPLETED },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
