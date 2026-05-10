import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Returns the pair of refund sigs once both are present. Used by the
 * second-signing party's UI to fetch the counterparty's sig so it can
 * submit `mutualRefundMilestone(eid, msIdx, clientSig, lawyerSig)` from
 * the wallet. Auth-gated to the engagement parties — no random caller can
 * harvest sigs.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    (me.role === Role.CLIENT && booking.clientId === me.id) ||
    (me.role === Role.LAWYER && booking.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    clientSig: booking.clientRefundSignature ?? null,
    lawyerSig: booking.lawyerRefundSignature ?? null,
  });
}
