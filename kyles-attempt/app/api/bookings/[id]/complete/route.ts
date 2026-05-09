import { NextResponse } from "next/server";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { releaseEscrow } from "@/lib/web3/escrow";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isClient = booking.clientId === me.id;
  const isLawyer = booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const receipt = booking.escrowTxHash ? await releaseEscrow(booking.id) : null;
  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.COMPLETED,
      escrowReleaseHash: receipt?.txHash ?? null,
    },
  });
  return NextResponse.json({ booking: updated });
}
