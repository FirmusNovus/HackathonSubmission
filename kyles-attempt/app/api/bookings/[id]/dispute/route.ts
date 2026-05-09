import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { disputeForBooking } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

// =============================================================================
// /api/bookings/[id]/dispute — F5
// -----------------------------------------------------------------------------
// Client opens a dispute against a Funded or Delivered proposal under this
// booking's engagement. Asymmetric — the client may dispute IMMEDIATELY (no
// cooldown). The chain layer enforces:
//   - msg.sender == engagement.client (NotEngagementClient otherwise),
//   - proposal.state ∈ {Funded, Delivered} (InvalidProposalState otherwise),
//   - engagement.state == Active (InvalidEngagementState otherwise).
//
// Body: { proposalIndex?: number } — defaults to 0 (the consultation).
//
// On success the booking shell flips to DISPUTED iff the disputed proposal IS
// the consultation (proposal[0]). Follow-up disputes leave the booking row
// alone; only the Proposal row reflects the dispute. See booking-bridge.ts
// for the rationale.
// =============================================================================

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Body parse — `proposalIndex` is optional; default to 0 for the consultation.
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

  // The client-only path is contract-mandated: only the booking's CLIENT may
  // dispute (the lawyer's path is the cooldown-gated escalate route). Lawyers
  // calling this get 403 — mirrors the `NotEngagementClient` revert.
  const isClient = booking.clientId === me.id;
  if (!isClient || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Forbidden — only the client may dispute." }, { status: 403 });
  }

  if (booking.engagementId == null) {
    return NextResponse.json(
      { error: "Booking is not on chain — cannot dispute." },
      { status: 409 },
    );
  }

  // Pull the engagement + target proposal to validate state before driving
  // the chain. The chain layer also re-checks under a Prisma transaction —
  // these pre-checks just give us nicer error shapes for the common cases.
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: booking.engagementId },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Engagement mirror missing" }, { status: 404 });
  }
  const proposal = await prisma.proposal.findUnique({
    where: { engagementId_proposalIndex: { engagementId: booking.engagementId, proposalIndex } },
  });
  if (!proposal) {
    return NextResponse.json(
      { error: { code: "InvalidProposalState", message: `No proposal at index ${proposalIndex}.` } },
      { status: 409 },
    );
  }

  // Use the engagement's current transcriptRoot. We don't anchor a fresh
  // root here because the dispute route doesn't deposit new messages; the
  // contract semantic of `disputeProposal(transcriptRoot)` is "anchor THIS
  // root atomically with the dispute". Passing the current root is a noop
  // anchor — if the UI wants to commit a new root it should call the
  // (future) anchor-transcript route first, then dispute.
  const transcriptRoot = engagement.transcriptRoot;

  let result: { txHash: string };
  try {
    result = await disputeForBooking({
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
