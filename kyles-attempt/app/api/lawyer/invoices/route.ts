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

const CreateLawyerInvoiceSchema = z.object({
  clientWalletAddress: z.string().min(4).max(80),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  practiceArea: z.string().min(1).max(60),
  caseDescription: z.string().min(1).max(4000),
  lineItems: z.array(LineItemSchema).min(1),
  deliverables: z.array(DeliverableSchema).min(1),
});

/**
 * Lawyer-initiated invoice. The lawyer fills in the line items + deliverables
 * for an existing client (identified by wallet address) and signs. The booking
 * is created with `lawyerAcceptedAt` set; the client's signature is still
 * required before any funds move.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: me.id } });
  if (!profile) {
    return NextResponse.json({ error: "You don't have a lawyer profile yet." }, { status: 400 });
  }
  const parsed = CreateLawyerInvoiceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const wallet = parsed.data.clientWalletAddress.trim().toLowerCase();
  const client = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!client) {
    return NextResponse.json(
      { error: `No client with wallet ${wallet}. Ask them to sign in once first.` },
      { status: 404 },
    );
  }
  if (client.role !== Role.CLIENT) {
    return NextResponse.json({ error: "That wallet belongs to a lawyer, not a client." }, { status: 400 });
  }

  const total = parsed.data.lineItems.reduce((sum, li) => sum + li.subtotal, 0);
  const platformFee = +(total * 0.05).toFixed(2);

  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      lawyerProfileId: profile.id,
      scheduledAt: new Date(parsed.data.scheduledAt),
      durationMinutes: parsed.data.durationMinutes,
      lineItems: parsed.data.lineItems,
      deliverables: parsed.data.deliverables,
      // Lawyer signs at creation; client still has to sign before escrow funds.
      clientAcceptedAt: null,
      lawyerAcceptedAt: new Date(),
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
      participants: { connect: [{ id: client.id }, { id: me.id }] },
    },
  });

  return NextResponse.json({ booking });
}
