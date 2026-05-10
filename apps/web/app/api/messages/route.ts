import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Phase 10: messages must be encrypted with NaCl box. The platform stores
 * ciphertext + nonce + sender's pubkey-at-send-time only — no plaintext
 * content for new messages. Older seeded rows that still have plaintext
 * `content` continue to render (UI marks them as legacy demo data).
 *
 * Both parties must have enrolled an encryption pubkey before they can
 * exchange messages. If either side hasn't, the API returns 412 with
 * `whoMissing: "self" | "counterparty"` so the UI can prompt the right
 * person.
 */
const Base64Re = /^[A-Za-z0-9+/]+=*$/;

const SendMessageSchema = z.object({
  conversationId: z.string().min(1),
  ciphertext: z.string().regex(Base64Re).max(8000),
  nonce: z.string().regex(Base64Re).max(40),
  senderEncryptionPublicKey: z.string().regex(Base64Re).max(50),
  attachmentUrl: z.string().min(1).max(500).optional(),
  attachmentType: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = SendMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    include: { participants: { select: { id: true, encryptionPublicKey: true } } },
  });
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (!conv.participants.some((p) => p.id === me.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Refuse the send if either party hasn't enrolled their pubkey — otherwise
  // we'd accept a ciphertext the recipient can never decrypt.
  const missingEnrollment = conv.participants.find((p) => !p.encryptionPublicKey);
  if (missingEnrollment) {
    return NextResponse.json(
      {
        error: "Both parties must enable secure messaging before exchanging messages.",
        whoMissing: missingEnrollment.id === me.id ? "self" : "counterparty",
      },
      { status: 412 },
    );
  }

  // Defence-in-depth: the sender's pubkey-at-send-time should match what we
  // have on file. The recipient would already detect mismatches via failed
  // box.open, but rejecting here gives the user a clearer error.
  const myPub = conv.participants.find((p) => p.id === me.id)?.encryptionPublicKey;
  if (myPub && myPub !== parsed.data.senderEncryptionPublicKey) {
    return NextResponse.json(
      {
        error:
          "Sender pubkey doesn't match the one on file. Re-enroll your messaging key on the messages page.",
      },
      { status: 400 },
    );
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderId: me.id,
      ciphertext: parsed.data.ciphertext,
      nonce: parsed.data.nonce,
      senderEncryptionPublicKey: parsed.data.senderEncryptionPublicKey,
      attachmentUrl: parsed.data.attachmentUrl,
      attachmentType: parsed.data.attachmentType,
    },
  });
  return NextResponse.json({ message });
}

export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { participants: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (!conv.participants.some((p) => p.id === me.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    include: {
      sender: { select: { id: true, name: true, walletAddress: true, role: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ messages });
}
