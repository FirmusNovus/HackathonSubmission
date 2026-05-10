import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishBookingChanged } from "@/lib/events/realtime";

/**
 * Decline a pending order. Either party can call this *before* both
 * signatures are present:
 *   - LAWYER declines a client-initiated order (clientAcceptedAt set, lawyer not).
 *   - CLIENT declines a lawyer-initiated order (lawyerAcceptedAt set, client not).
 * Once both sides have signed (escrow is funded → ACCEPTED), neither side can
 * decline — they have to go through completion or dispute.
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

  const isClient = booking.clientId === me.id && me.role === Role.CLIENT;
  const isLawyer = booking.lawyerProfile.userId === me.id && me.role === Role.LAWYER;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (booking.clientAcceptedAt && booking.lawyerAcceptedAt) {
    return NextResponse.json(
      { error: "Both parties have already signed — escrow is funded or pending. Use complete or dispute instead." },
      { status: 409 },
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.DECLINED },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
