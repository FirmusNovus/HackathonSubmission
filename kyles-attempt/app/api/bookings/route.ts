import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { hasVerifiedCapability } from "@/lib/auth/capability";
import { SCHEMA_CLIENT, SCHEMA_LAWYER } from "@/lib/chain/schemas";
import { openEngagementForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const LineItemSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  kind: z.enum(["hourly", "fixed"]),
  hours: z.number().nonnegative().optional(),
  ratePerHour: z.number().nonnegative().optional(),
  fixedPrice: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative(),
});

const DeliverableSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(140),
  description: z.string().max(500).optional(),
});

const CreateBookingSchema = z.object({
  lawyerProfileId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  practiceArea: z.string().min(1).max(60),
  caseDescription: z.string().min(1).max(4000),
  lineItems: z.array(LineItemSchema).min(1),
  deliverables: z.array(DeliverableSchema).min(1),
});

export async function POST(request: Request) {
  // Resolve the user fresh from the DB (by walletAddress, not the JWT's cuid).
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

  // F2 capability gates. The mock-chain `openEngagementAndFundFirstProposal`
  // ALREADY enforces these — but escrow funding doesn't happen until /accept,
  // so without an early gate here a client could spend time filling out a
  // booking only to fail at funding. We surface NotVerifiedClient /
  // NotVerifiedLawyer up front with the same codes the chain layer uses.
  const lawyerOk = await hasVerifiedCapability(lawyer.user.walletAddress, SCHEMA_LAWYER);
  if (!lawyerOk) {
    return NextResponse.json(
      { code: "NotVerifiedLawyer", error: "Lawyer is not currently verified." },
      { status: 409 },
    );
  }
  const clientOk = await hasVerifiedCapability(me.walletAddress, SCHEMA_CLIENT);
  if (!clientOk) {
    return NextResponse.json(
      { code: "NotVerifiedClient", error: "Client must complete age verification before booking." },
      { status: 403 },
    );
  }

  // Server-side total — never trust a client-provided fee.
  const total = parsed.data.lineItems.reduce((sum, li) => sum + li.subtotal, 0);
  const platformFee = +(total * 0.05).toFixed(2);

  // F3: open the Engagement on-chain in the SAME flow as booking creation.
  // This is a meaningful UX change — the client now commits funds at booking
  // time, not at lawyer-accept time. Mirrors System A's contract semantic:
  // `openEngagementAndFundFirstProposal` is a single tx; the lawyer never
  // funds. Decline → mutual refund (F6 wires the refund flow).
  //
  // Two cases:
  //   - free  (consultationFeeEUR === 0): openFreeEngagement → Proposal[0]
  //     materialised at amountWei=0; the deliver→release flow is uniform.
  //   - paid: openEngagementAndFundFirstProposal → Proposal[0] funded.
  // Either way, Booking.engagementId + Booking.escrowTxHash are set on the
  // returned row; status stays REQUESTED until the lawyer accepts.
  const booking = await prisma.booking.create({
    data: {
      clientId: me.id,
      lawyerProfileId: lawyer.id,
      scheduledAt: new Date(parsed.data.scheduledAt),
      durationMinutes: parsed.data.durationMinutes,
      lineItems: parsed.data.lineItems,
      deliverables: parsed.data.deliverables,
      clientAcceptedAt: new Date(),
      lawyerAcceptedAt: null,
      consultationFeeEUR: total,
      platformFeeEUR: platformFee,
      status: BookingStatus.REQUESTED,
      practiceArea: parsed.data.practiceArea,
      caseDescription: parsed.data.caseDescription,
    },
  });

  await prisma.conversation.create({
    data: {
      bookingId: booking.id,
      participants: { connect: [{ id: me.id }, { id: lawyer.userId }] },
    },
  });

  try {
    await openEngagementForBooking({
      id: booking.id,
      caseDescription: booking.caseDescription,
      practiceArea: booking.practiceArea,
      consultationFeeEUR: total,
      clientWallet: me.walletAddress,
      lawyerWallet: lawyer.user.walletAddress,
      jurisdiction: lawyer.barJurisdiction,
    });
  } catch (err) {
    // The chain open failed; the Booking row + Conversation are still useful
    // (the client can retry the open from the UI). Surface the typed chain
    // error so the form can render the right toast. The Booking row remains
    // at REQUESTED with engagementId=null so a follow-up can retry.
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      // Hand back the booking row alongside the error so the client can
      // navigate to it for the retry path. UX-wise this matches A's "the
      // engagement entry exists, but the chain submit failed" flow.
      return NextResponse.json({ booking, error: body }, { status });
    }
    throw err;
  }

  // Re-read so the returned row reflects engagementId / escrowTxHash.
  const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
  return NextResponse.json({ booking: fresh });
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
