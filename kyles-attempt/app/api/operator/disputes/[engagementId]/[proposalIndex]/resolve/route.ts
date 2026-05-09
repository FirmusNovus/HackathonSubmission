// =============================================================================
// /api/operator/disputes/[engagementId]/[proposalIndex]/resolve — F7
// -----------------------------------------------------------------------------
// Operator-only dispute resolution. Mirrors `LegalEngagementEscrow.resolveDispute`
// — the chain layer enforces:
//   - msg.sender == operator (OnlyOperator otherwise),
//   - proposal.state == Disputed (InvalidProposalState otherwise),
//   - toLawyer + toClient == proposal.amountWei (InvalidSplit otherwise).
//
// Body: { toLawyerWei: string, toClientWei: string } — both decimal-string wei.
//
// We pre-validate sum-equality server-side BEFORE driving the chain layer so
// the response shape is consistent regardless of mock vs real chain. The
// chain layer also re-checks under a Prisma transaction.
//
// On success the booking shell flips to COMPLETED iff the resolved proposal IS
// the consultation (proposal[0]). Follow-up resolves leave the booking row
// alone — see booking-bridge.resolveDisputeForBooking for rationale.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireOperator } from "@/lib/auth/session";
import { resolveDisputeForBooking, resolveDisputeForProposal } from "@/lib/chain/booking-bridge";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";
import { weiToBigInt } from "@/lib/chain/units";

const Schema = z.object({
  toLawyerWei: z.string().regex(/^\d+$/, "must be decimal-string wei"),
  toClientWei: z.string().regex(/^\d+$/, "must be decimal-string wei"),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ engagementId: string; proposalIndex: string }> },
) {
  const session = await requireOperator();

  const { engagementId: engIdRaw, proposalIndex: propIdxRaw } = await ctx.params;
  const engagementId = Number(engIdRaw);
  const proposalIndex = Number(propIdxRaw);
  if (!Number.isInteger(engagementId) || engagementId < 1) {
    return NextResponse.json({ error: "Invalid engagementId" }, { status: 400 });
  }
  if (!Number.isInteger(proposalIndex) || proposalIndex < 0) {
    return NextResponse.json({ error: "Invalid proposalIndex" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Look up the proposal so we can validate sum-equality + state + the booking
  // mapping (if any). The chain layer re-checks under a Prisma transaction,
  // but pre-validating here gives us nicer error shapes for the common cases.
  const proposal = await prisma.proposal.findUnique({
    where: { engagementId_proposalIndex: { engagementId, proposalIndex } },
  });
  if (!proposal) {
    return NextResponse.json(
      { error: { code: "InvalidProposalState", message: "Proposal not found." } },
      { status: 404 },
    );
  }
  if (proposal.state !== "DISPUTED") {
    return NextResponse.json(
      {
        error: {
          code: "InvalidProposalState",
          message: `Proposal is in state ${proposal.state}; only DISPUTED proposals can be resolved.`,
        },
      },
      { status: 409 },
    );
  }

  // Sum-equality check (mirrors the contract's `InvalidSplit`).
  let toLawyer: bigint;
  let toClient: bigint;
  let total: bigint;
  try {
    toLawyer = weiToBigInt(parsed.data.toLawyerWei);
    toClient = weiToBigInt(parsed.data.toClientWei);
    total = weiToBigInt(proposal.amountWei);
  } catch {
    return NextResponse.json(
      { error: { code: "InvalidSplit", message: "Amounts must be non-negative wei integers." } },
      { status: 422 },
    );
  }
  if (toLawyer < 0n || toClient < 0n) {
    return NextResponse.json(
      { error: { code: "InvalidSplit", message: "Amounts must be non-negative." } },
      { status: 422 },
    );
  }
  if (toLawyer + toClient !== total) {
    return NextResponse.json(
      {
        error: {
          code: "InvalidSplit",
          message: `Sum ${toLawyer + toClient} ≠ proposal amount ${total}.`,
          expected: total.toString(10),
          got: (toLawyer + toClient).toString(10),
        },
      },
      { status: 422 },
    );
  }

  // Find the booking (if any) to drive the booking-shell flip when the
  // resolved proposal is proposal[0]. Follow-up proposals don't have a 1:1
  // booking shell, so we route through `resolveDisputeForProposal` instead.
  const booking = await prisma.booking.findFirst({ where: { engagementId } });

  let txHash: string;
  try {
    if (booking && proposalIndex === booking.proposalIndex) {
      const result = await resolveDisputeForBooking({
        booking: {
          id: booking.id,
          engagementId: booking.engagementId,
          proposalIndex: booking.proposalIndex,
        },
        proposalIndex,
        toLawyerWei: toLawyer,
        toClientWei: toClient,
        fromAddress: session.user.walletAddress,
      });
      txHash = result.txHash;
    } else {
      const result = await resolveDisputeForProposal({
        engagementId,
        proposalIndex,
        toLawyerWei: toLawyer,
        toClientWei: toClient,
        fromAddress: session.user.walletAddress,
      });
      txHash = result.txHash;
    }
  } catch (err) {
    if (isChainError(err)) {
      const { status, body: errBody } = chainErrorToHttp(err);
      return NextResponse.json({ error: errBody }, { status });
    }
    throw err;
  }

  return NextResponse.json({
    txHash,
    transitionedTo: "RESOLVED",
    engagementId,
    proposalIndex,
    toLawyerWei: toLawyer.toString(10),
    toClientWei: toClient.toString(10),
  });
}
