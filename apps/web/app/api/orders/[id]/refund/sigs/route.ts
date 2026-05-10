import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Mirror of /api/bookings/[id]/refund/sigs for follow-up Order milestones.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    (me.role === Role.CLIENT && order.engagement.clientId === me.id) ||
    (me.role === Role.LAWYER && order.engagement.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    clientSig: order.clientRefundSignature ?? null,
    lawyerSig: order.lawyerRefundSignature ?? null,
  });
}
