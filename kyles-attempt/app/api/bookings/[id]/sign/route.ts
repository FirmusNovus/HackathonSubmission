import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { openEngagementForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

/**
 * Client-side signature on a lawyer-initiated invoice. Symmetric to
 * `/api/bookings/[id]/accept` (the lawyer's signature). Sets
 * `clientAcceptedAt`; if the lawyer has also signed AND the engagement is
 * not yet open, opens + funds it via the bridge.
 *
 * F3 update — the chain-open call moved from `/accept` (lawyer) to here
 * (client) for lawyer-initiated flows, because the contract requires the
 * client wallet to be `msg.sender` on `openEngagementAndFundFirstProposal`.
 * For client-initiated bookings the open already happened at POST /api/bookings.
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

  // If the lawyer has already signed AND the engagement isn't open yet,
  // this client signature opens + funds it.
  const shouldOpenChain = Boolean(booking.lawyerAcceptedAt) && booking.engagementId == null;
  if (shouldOpenChain) {
    try {
      await openEngagementForBooking({
        id: booking.id,
        caseDescription: booking.caseDescription,
        practiceArea: booking.practiceArea,
        consultationFeeEUR: booking.consultationFeeEUR,
        clientWallet: me.walletAddress,
        lawyerWallet: booking.lawyerProfile.user.walletAddress,
        jurisdiction: booking.lawyerProfile.barJurisdiction,
      });
    } catch (err) {
      if (isChainError(err)) {
        const { status, body } = chainErrorToHttp(err);
        return NextResponse.json({ error: body }, { status });
      }
      throw err;
    }
  }

  const advanceToAccepted = Boolean(booking.lawyerAcceptedAt);
  const updated = await prisma.booking.update({
    where: { id },
    data: {
      clientAcceptedAt: new Date(),
      ...(advanceToAccepted ? { status: BookingStatus.ACCEPTED } : {}),
    },
  });
  return NextResponse.json({ booking: updated });
}
