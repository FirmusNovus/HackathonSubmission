import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { createEscrow } from "@/lib/web3/escrow";

/**
 * Client-side signature on a lawyer-initiated invoice. Symmetric to
 * `/api/bookings/[id]/accept` (the lawyer's signature). Sets
 * `clientAcceptedAt`; if the lawyer has also signed, funds the escrow and
 * advances to ACCEPTED.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: { include: { user: true } } },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.clientAcceptedAt) {
    return NextResponse.json({ booking }); // idempotent — already signed
  }

  // If the lawyer has already signed, this client signature is the second
  // signature → fund escrow and advance to ACCEPTED.
  const fundEscrow = Boolean(booking.lawyerAcceptedAt);
  const receipt =
    fundEscrow && Number(booking.consultationFeeEUR) > 0
      ? await createEscrow({
          bookingId: booking.id,
          clientWallet: me.walletAddress,
          lawyerWallet: booking.lawyerProfile.user.walletAddress,
          amountEUR: Number(booking.consultationFeeEUR),
        })
      : null;

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      clientAcceptedAt: new Date(),
      ...(fundEscrow
        ? { status: BookingStatus.ACCEPTED, escrowTxHash: receipt?.txHash ?? null }
        : {}),
    },
  });
  return NextResponse.json({ booking: updated });
}
