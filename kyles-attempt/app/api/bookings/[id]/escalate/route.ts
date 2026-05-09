import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { escalateForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

// =============================================================================
// /api/bookings/[id]/escalate — F5
// -----------------------------------------------------------------------------
// Lawyer escalates a Delivered proposal to operator review after the 30-day
// cooldown. Asymmetric counterpart to the client's `/dispute` route.
//
// The chain layer enforces:
//   - msg.sender == engagement.lawyer (NotEngagementLawyer otherwise),
//   - proposal.state == Delivered (InvalidProposalState otherwise),
//   - block.timestamp >= deliveredAt + 30d (CooldownNotElapsed otherwise).
//
// `CooldownNotElapsed` carries the absolute `unlockAt` so the UI can show an
// exact countdown without round-tripping for the cooldown duration. We map
// it to HTTP 425 (Too Early) with a `{code, unlockAt}` body. Other chain
// errors map via `chainErrorToHttp` as usual.
//
// Body: { proposalIndex?: number } — defaults to 0 (the consultation).
// =============================================================================

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { proposalIndex?: unknown } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as { proposalIndex?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const proposalIndex =
    body.proposalIndex === undefined || body.proposalIndex === null ? 0 : Number(body.proposalIndex);
  if (!Number.isInteger(proposalIndex) || proposalIndex < 0) {
    return NextResponse.json({ error: "proposalIndex must be a non-negative integer" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Lawyer-only — only the booking's lawyer may escalate. Clients calling
  // this get 403 (they have the immediate `/dispute` path instead). Mirrors
  // the `NotEngagementLawyer` revert.
  const isLawyer = booking.lawyerProfile.userId === me.id;
  if (!isLawyer || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Forbidden — only the lawyer may escalate." }, { status: 403 });
  }

  if (booking.engagementId == null) {
    return NextResponse.json(
      { error: "Booking is not on chain — cannot escalate." },
      { status: 409 },
    );
  }

  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: booking.engagementId },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Engagement mirror missing" }, { status: 404 });
  }
  // Pre-check the proposal exists. State (Delivered) + cooldown timing are
  // enforced inside the chain call — we surface the ChainError shape rather
  // than duplicating the gate here.
  const proposal = await prisma.proposal.findUnique({
    where: { engagementId_proposalIndex: { engagementId: booking.engagementId, proposalIndex } },
  });
  if (!proposal) {
    return NextResponse.json(
      { error: { code: "InvalidProposalState", message: `No proposal at index ${proposalIndex}.` } },
      { status: 409 },
    );
  }

  const transcriptRoot = engagement.transcriptRoot;

  let result: { txHash: string };
  try {
    result = await escalateForBooking({
      booking: {
        id: booking.id,
        engagementId: booking.engagementId,
        proposalIndex: booking.proposalIndex,
      },
      proposalIndex,
      fromAddress: me.walletAddress,
      transcriptRoot,
    });
  } catch (err) {
    if (isChainError(err)) {
      // chainErrorToHttp already special-cases CooldownNotElapsed → 425 with
      // `unlockAt` in the body. We surface that as `error.code` +
      // `error.unlockAt` so the UI can drive a precise countdown.
      const { status, body: errBody } = chainErrorToHttp(err);
      return NextResponse.json({ error: errBody }, { status });
    }
    throw err;
  }

  const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });
  return NextResponse.json({
    booking: fresh,
    proposalIndex,
    txHash: result.txHash,
  });
}
