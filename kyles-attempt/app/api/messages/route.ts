import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

const SendMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1).max(4000),
  // The upload endpoint returns a relative path ("/api/uploads/…"), not an
  // absolute URL — accept either.
  attachmentUrl: z.string().min(1).max(500).optional(),
  attachmentType: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = SendMessageSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    include: { participants: true },
  });
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (!conv.participants.some((p) => p.id === me.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderId: me.id,
      content: parsed.data.content,
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
