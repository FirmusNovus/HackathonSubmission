import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Lawyer declines a client-initiated booking. F3 update — escrow is FUNDED
 * at booking-creation time (System A's contract semantic), so a decline does
 * NOT release funds back to the client automatically. The Proposal stays in
 * state=FUNDED with no lawyer action ever taken; F6 wires the mutual-refund
 * flow (both parties sign an EIP-712 refund auth → `mutualRefundProposal`)
 * to free the funds.
 *
 * For F3 we set Booking.status=DECLINED and document the lingering state.
 * The UI surfaces "Awaiting refund — F6" until the bridge route lands.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const updated = await prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.DECLINED },
  });
  return NextResponse.json({ booking: updated });
}
