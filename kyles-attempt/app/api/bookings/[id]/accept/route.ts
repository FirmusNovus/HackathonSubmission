import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { createEscrow } from "@/lib/web3/escrow";

/**
 * The lawyer signs the invoice. Both signatures present → escrow funds → the
 * booking advances to ACCEPTED. The escrow is created HERE rather than at
 * booking-creation time so the user-visible state machine is:
 *
 *     1. Client signs invoice (POST /api/bookings)            → REQUESTED
 *     2. Lawyer signs invoice (POST /api/bookings/[id]/accept) → ACCEPTED, escrow funded
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true, client: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!booking.clientAcceptedAt) {
    return NextResponse.json(
      { error: "Client has not signed this invoice — cannot accept yet." },
      { status: 409 },
    );
  }

  // STUB: simulate the smart-contract escrow funding. In production this is
  // signed and submitted by the client's wallet, then verified server-side.
  const receipt = Number(booking.consultationFeeEUR) > 0
    ? await createEscrow({
        bookingId: booking.id,
        clientWallet: booking.client.walletAddress,
        lawyerWallet: me.walletAddress,
        amountEUR: Number(booking.consultationFeeEUR),
      })
    : null;

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.ACCEPTED,
      lawyerAcceptedAt: new Date(),
      escrowTxHash: receipt?.txHash ?? null,
    },
  });
  return NextResponse.json({ booking: updated });
}
