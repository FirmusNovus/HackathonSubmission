import { NextResponse } from "next/server";
import { z } from "zod";
import { parseEther, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import {
  BOOKING_TYPES,
  buildBookingDomain,
  hashCaseDescription,
  type BookingRequestPayload,
} from "@/lib/web3/booking-eip712";

const CreateBookingSchema = z.object({
  lawyerProfileId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  practiceArea: z.string().min(1).max(60),
  caseDescription: z.string().min(1).max(4000),
  // EIP-712 signature over the BookingRequest typed data (see
  // lib/web3/booking-eip712.ts). Hex-encoded with 0x prefix. Optional only
  // for dev-login fixture sessions which have no real wallet to sign with.
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "signature must be hex").optional(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]+$/, "nonce must be hex").optional(),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const parsed = CreateBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const lawyer = await prisma.lawyerProfile.findUnique({
    where: { id: parsed.data.lawyerProfileId },
    include: { user: true },
  });
  if (!lawyer) return NextResponse.json({ error: "Lawyer not found" }, { status: 404 });

  const rate =
    parsed.data.durationMinutes === 30
      ? Number(lawyer.consultationRate30)
      : Number(lawyer.consultationRate60);
  if (!(rate > 0)) {
    return NextResponse.json(
      { error: `Lawyer has no ${parsed.data.durationMinutes}-minute consultation rate set.` },
      { status: 400 },
    );
  }

  const clientWallet = me.walletAddress as Address;
  const isDevLogin = me.devLogin === true;

  // Real (SIWE) sessions must include + verify a wallet signature. Dev-login
  // fixtures (Playwright + sse-smoke) have no private key for their fake
  // 0x1111… addresses, so we accept their unsigned requests. The dev-login
  // provider itself is gated to NODE_ENV !== "production".
  if (!isDevLogin) {
    if (!parsed.data.signature || !parsed.data.nonce) {
      return NextResponse.json({ error: "Wallet signature required." }, { status: 400 });
    }
    const consultationFeeWei = parseEther(rate.toFixed(18));
    const scheduledAtUnix = BigInt(Math.floor(new Date(parsed.data.scheduledAt).getTime() / 1000));
    const caseDescriptionHash = hashCaseDescription(parsed.data.caseDescription);
    const message: BookingRequestPayload = {
      client: clientWallet,
      lawyerProfileId: lawyer.id,
      scheduledAtUnix,
      durationMinutes: BigInt(parsed.data.durationMinutes),
      consultationFeeWei,
      practiceArea: parsed.data.practiceArea,
      caseDescriptionHash,
      nonce: parsed.data.nonce,
    };
    const domain = buildBookingDomain({
      chainId: getChainId(),
      verifyingContract: getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    });
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: BOOKING_TYPES,
        primaryType: "BookingRequest",
        message,
        signature: parsed.data.signature as Hex,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not recover signer: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    if (recovered.toLowerCase() !== clientWallet.toLowerCase()) {
      return NextResponse.json(
        { error: `Signature was made by ${recovered}, not the signed-in wallet ${clientWallet}.` },
        { status: 400 },
      );
    }
  }

  const platformFee = +(rate * 0.05).toFixed(4);

  const booking = await prisma.booking.create({
    data: {
      clientId: me.id,
      lawyerProfileId: lawyer.id,
      scheduledAt: new Date(parsed.data.scheduledAt),
      durationMinutes: parsed.data.durationMinutes,
      clientAcceptedAt: new Date(),
      lawyerAcceptedAt: null,
      consultationFeeEUR: rate,
      platformFeeEUR: platformFee,
      status: BookingStatus.REQUESTED,
      practiceArea: parsed.data.practiceArea,
      caseDescription: parsed.data.caseDescription,
      clientRequestSignature: parsed.data.signature ?? null,
      clientRequestNonce: parsed.data.nonce ?? null,
    },
  });

  await prisma.conversation.create({
    data: {
      bookingId: booking.id,
      participants: { connect: [{ id: me.id }, { id: lawyer.userId }] },
    },
  });

  return NextResponse.json({ booking });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role === Role.CLIENT) {
    const bookings = await prisma.booking.findMany({
      where: { clientId: me.id },
      include: { lawyerProfile: { include: { user: true } } },
      orderBy: { scheduledAt: "desc" },
    });
    return NextResponse.json({ bookings });
  }
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: me.id } });
  if (!profile) return NextResponse.json({ bookings: [] });
  const bookings = await prisma.booking.findMany({
    where: { lawyerProfileId: profile.id },
    include: { client: true, lawyerProfile: { include: { user: true } } },
    orderBy: { scheduledAt: "desc" },
  });
  return NextResponse.json({ bookings });
}
