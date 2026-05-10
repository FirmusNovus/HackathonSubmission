import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishOrderChanged } from "@/lib/events/realtime";

/**
 * Lawyer rescinds a follow-up order they sent, before the client funds it.
 * No chain action — once funded, the lawyer can't unilaterally cancel; that
 * path goes through the dispute / refund mechanism (Phase 9).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.engagement.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.status !== "REQUESTED") {
    return NextResponse.json(
      { error: `Order is ${order.status} — cancel only works while REQUESTED.` },
      { status: 409 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
