import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Mirror of /api/bookings/[id]/dispute/archive but for follow-up Order
 * disputes. Same encryption shape — bundle entries are NaCl box ciphertexts
 * to the arbiter.
 */
const Base64Re = /^[A-Za-z0-9+/]+=*$/;

const ArchiveSchema = z.object({
  submitterEncryptionPublicKey: z.string().regex(Base64Re).max(50),
  encryptedBundle: z
    .array(
      z.object({
        originalMessageId: z.string().min(1).max(40),
        ciphertextForArbiter: z.string().regex(Base64Re).max(20_000),
        nonce: z.string().regex(Base64Re).max(40),
        originalSenderId: z.string().min(1).max(40),
        originalSenderEncryptionPublicKey: z.string().regex(Base64Re).nullable(),
        originalCreatedAt: z.string().datetime(),
      }),
    )
    .max(2_000),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = ArchiveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    (me.role === Role.CLIENT && order.engagement.clientId === me.id) ||
    (me.role === Role.LAWYER && order.engagement.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (order.status !== "DISPUTED") {
    return NextResponse.json(
      { error: `Order is ${order.status} — archive submission only meaningful while DISPUTED.` },
      { status: 409 },
    );
  }

  await prisma.disputeArchive.deleteMany({
    where: { orderId: id, submittedById: me.id },
  });
  const archive = await prisma.disputeArchive.create({
    data: {
      orderId: id,
      submittedById: me.id,
      submitterEncryptionPublicKey: parsed.data.submitterEncryptionPublicKey,
      encryptedBundle: JSON.stringify(parsed.data.encryptedBundle),
    },
  });

  return NextResponse.json({ archive: { id: archive.id, submittedAt: archive.submittedAt } });
}
