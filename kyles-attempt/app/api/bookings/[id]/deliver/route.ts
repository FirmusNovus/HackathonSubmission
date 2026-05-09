import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { markDeliveredForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

/**
 * Lawyer marks the consultation deliverable. Mirrors
 * `LegalEngagementEscrow.markDelivered(engagementId, proposalIndex)`.
 *
 * In the happy path the client then releases the funds via /complete. The
 * lawyer's "mark delivered" is OPTIONAL (the client can release a Funded
 * proposal too) but it's the conventional UX flow because:
 *   1. it gives the client a "lawyer says done" signal before they release;
 *   2. it locks in `proposal.deliveredAt`, which starts the 30-day cooldown
 *      for the lawyer's escalate-to-dispute path (F5).
 *
 * Auth: only the booking's lawyer may call this (matches the
 * `NotEngagementLawyer` revert in the contract).
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.engagementId == null) {
    return NextResponse.json(
      { error: "Booking is not on chain — cannot mark delivered." },
      { status: 409 },
    );
  }

  try {
    await markDeliveredForBooking(
      { id: booking.id, engagementId: booking.engagementId, proposalIndex: booking.proposalIndex },
      me.walletAddress,
    );
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }

  const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
  return NextResponse.json({ booking: fresh });
}
