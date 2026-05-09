import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { releaseForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

/**
 * Client releases the consultation proposal — funds flow to the lawyer. F3
 * routes this to `releaseProposal` on the chain via the bridge.
 *
 * Contract semantic (mirrored from `LegalEngagementEscrow.releaseProposal`):
 * the client may release a proposal that's in state FUNDED *or* DELIVERED.
 * The lawyer's `markDelivered` is optional — the client can finish the call
 * and release without it. This eliminates the lawyer's mandatory tx in the
 * happy path.
 *
 * Auth: only the booking's CLIENT may call this (mirrors the
 * `NotEngagementClient` revert in the contract). Lawyers calling this are
 * 403'd at the route level so we never even attempt the chain call.
 *
 * Legacy fallback: bookings seeded before F3 may have engagementId=null. We
 * do a status-only flip in that case so the lawyer dashboard "Mark Complete"
 * button on a pre-F3 row still works. Production won't see this path because
 * F3 onwards the migration backfill (or the run-once seed reset) ensures all
 * non-declined rows have an engagement.
 */
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

  // F3: only the client may release. The lawyer's path on this route used to
  // exist as a convenience (lawyer marks complete after consultation), but
  // the contract semantic is client-only — so we restrict here too. Lawyers
  // get the dedicated /deliver route to mark the proposal deliverable.
  if (me.role === Role.LAWYER) {
    return NextResponse.json(
      {
        error: "Only the client can release escrow. Use /deliver to mark the consultation deliverable.",
      },
      { status: 403 },
    );
  }

  // Pre-F3 fallback — no engagementId means there's nothing to release.
  if (booking.engagementId == null) {
    const updated = await prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.COMPLETED },
    });
    return NextResponse.json({ booking: updated });
  }

  try {
    await releaseForBooking(
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
