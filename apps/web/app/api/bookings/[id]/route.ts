import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

// GET a single booking. The booking is visible to the client who owns it and the
// lawyer it's been routed to. Resolves the user fresh by walletAddress so the
// caller's session survives a database reseed.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, walletAddress: true } },
      lawyerProfile: { include: { user: { select: { id: true, name: true, walletAddress: true } } } },
      conversation: { select: { id: true } },
    },
  });

  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isClient = booking.client.id === me.id;
  const isLawyer = booking.lawyerProfile.user.id === me.id;
  if (me.role === Role.CLIENT && !isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (me.role === Role.LAWYER && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ booking });
}
