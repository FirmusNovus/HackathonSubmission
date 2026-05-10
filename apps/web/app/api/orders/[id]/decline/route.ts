import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishOrderChanged } from "@/lib/events/realtime";

/**
 * Client declines a follow-up order. No chain action — declined orders
 * sit in DECLINED state and never funded. Lawyer is free to send a new one.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.engagement.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.status !== "REQUESTED") {
    return NextResponse.json(
      { error: `Order is ${order.status} — only REQUESTED orders can be declined.` },
      { status: 409 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: "DECLINED" },
  });
  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
