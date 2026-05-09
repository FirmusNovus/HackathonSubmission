import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

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

  // Server-side total — never trust a client-provided fee.
  const total = parsed.data.lineItems.reduce((sum, li) => sum + li.subtotal, 0);
  const platformFee = +(total * 0.05).toFixed(2);

  // Booking is REQUESTED until the LAWYER also signs. Escrow funding happens
  // at /api/bookings/[id]/accept once both signatures are present — never on
  // the initial POST. This way "Could not create booking" is never confused
  // with "Could not fund escrow".
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
