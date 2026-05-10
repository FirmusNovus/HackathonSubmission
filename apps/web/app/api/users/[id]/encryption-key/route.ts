import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Returns another user's enrolled X25519 messaging pubkey, so the caller
 * can encrypt outgoing messages to them. Auth-gated to engagement parties:
 * the caller must share at least one Conversation with the target user
 * (which by construction means they're either the lawyer or client on the
 * same Booking). This means random users can't enumerate everyone's pubkey.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  // Self-fetch is fine.
  if (id === me.id) {
    return NextResponse.json({ encryptionPublicKey: me.encryptionPublicKey });
  }

  // Walk the conversations the caller participates in and check the target
  // is in one of them. (Two queries keeps the SQL straightforward at the
  // cost of one extra round-trip vs a join.)
  const sharedConv = await prisma.conversation.findFirst({
    where: {
      participants: { some: { id: me.id } },
      AND: { participants: { some: { id } } },
    },
    select: { id: true },
  });
  // Either party also gets to look up the other side via the booking they're
  // both on, even if Conversation row drifted. This is belt-and-braces — the
  // common path is the conversation join above.
  let allowed = Boolean(sharedConv);
  if (!allowed) {
    const sharedBooking = await prisma.booking.findFirst({
      where:
        me.role === Role.CLIENT
          ? { clientId: me.id, lawyerProfile: { userId: id } }
          : { client: { id }, lawyerProfile: { userId: me.id } },
      select: { id: true },
    });
    allowed = Boolean(sharedBooking);
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { encryptionPublicKey: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ encryptionPublicKey: target.encryptionPublicKey });
}
