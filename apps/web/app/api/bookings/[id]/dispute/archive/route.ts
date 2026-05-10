import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * One party's encrypted account of the conversation, submitted to the
 * arbiter on a DISPUTED milestone. Each entry was decrypted client-side
 * (the submitter is a party so they can read every message), then
 * re-encrypted with NaCl box using the arbiter's pubkey + the
 * submitter's privkey. The arbiter recovers it with their privkey + the
 * stored submitter pubkey.
 *
 * Both parties can submit independently. The arbiter sees both archives;
 * discrepancies between them are themselves evidence.
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

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    (me.role === Role.CLIENT && booking.clientId === me.id) ||
    (me.role === Role.LAWYER && booking.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (booking.status !== "DISPUTED") {
    return NextResponse.json(
      { error: `Booking is ${booking.status} — archive submission only meaningful while DISPUTED.` },
      { status: 409 },
    );
  }

  // Replace any existing archive from this submitter (idempotent / re-submit).
  await prisma.disputeArchive.deleteMany({
    where: { bookingId: id, submittedById: me.id },
  });
  const archive = await prisma.disputeArchive.create({
    data: {
      bookingId: id,
      submittedById: me.id,
      submitterEncryptionPublicKey: parsed.data.submitterEncryptionPublicKey,
      encryptedBundle: JSON.stringify(parsed.data.encryptedBundle),
    },
  });

  return NextResponse.json({ archive: { id: archive.id, submittedAt: archive.submittedAt } });
}
