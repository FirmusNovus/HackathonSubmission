import { NextResponse } from "next/server";
import { z } from "zod";
import { parseEther, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishBookingChanged } from "@/lib/events/realtime";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import {
  BOOKING_ACCEPT_TYPES,
  buildBookingDomain,
  type BookingAcceptPayload,
} from "@/lib/web3/booking-eip712";

/**
 * Lawyer accepts a client-initiated booking. State machine:
 *
 *   1. Client books              → REQUESTED, clientAcceptedAt set
 *   2. Lawyer accepts (this)      → REQUESTED, lawyerAcceptedAt set
 *   3. Client funds escrow        → ACCEPTED  (see /api/bookings/[id]/funded)
 *
 * The lawyer signs an EIP-712 BookingAccept message — proves their wallet
 * authorised THIS specific booking (id + fee + scheduled time), not just
 * that they're logged in. Server rejects anything that doesn't recover to
 * the SIWE-bound lawyer wallet.
 */
const AcceptSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isDevLogin = me.devLogin === true;
  const parsed = AcceptSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!isDevLogin && (!parsed.data.signature || !parsed.data.nonce)) {
    return NextResponse.json({ error: "Wallet signature required on accept." }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!booking.clientAcceptedAt) {
    return NextResponse.json(
      { error: "Client has not signed this order — cannot accept yet." },
      { status: 409 },
    );
  }
  if (booking.lawyerAcceptedAt) {
    return NextResponse.json({ booking }); // idempotent
  }

  const lawyerWallet = me.walletAddress as Address;
  if (!isDevLogin) {
    const message: BookingAcceptPayload = {
      lawyer: lawyerWallet,
      bookingId: booking.id,
      consultationFeeWei: parseEther(Number(booking.consultationFeeEUR).toFixed(18)),
      scheduledAtUnix: BigInt(Math.floor(booking.scheduledAt.getTime() / 1000)),
      nonce: parsed.data.nonce!,
    };
    const domain = buildBookingDomain({
      chainId: getChainId(),
      verifyingContract: getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    });
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: BOOKING_ACCEPT_TYPES,
        primaryType: "BookingAccept",
        message,
        signature: parsed.data.signature as Hex,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not recover signer: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    if (recovered.toLowerCase() !== lawyerWallet.toLowerCase()) {
      return NextResponse.json(
        { error: `Signature was made by ${recovered}, not the signed-in lawyer wallet ${lawyerWallet}.` },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      lawyerAcceptedAt: new Date(),
      lawyerAcceptSignature: parsed.data.signature ?? null,
      lawyerAcceptNonce: parsed.data.nonce ?? null,
    },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
