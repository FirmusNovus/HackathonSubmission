// =============================================================================
// /api/proposals/[id]/fund
// -----------------------------------------------------------------------------
// Client funds a previously-published `ProposalOffer`. The mock chain's
// `fundProposal` does the cryptographic verification (real EIP-712), burns
// the nonce on success via the ConsumedProposalNonce mirror, and creates
// the new Proposal row. We then mark the offer as consumed locally and
// return the materialised proposalIndex + tx hash.
// =============================================================================

import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { fundProposal } from "@/lib/chain/escrow";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offer = await prisma.proposalOffer.findUnique({ where: { id } });
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  if (offer.consumedAt) {
    return NextResponse.json(
      { error: { code: "OfferAlreadyConsumed", message: "This offer has already been funded." } },
      { status: 409 },
    );
  }

  // Authorize: the caller must be the client of the offer's engagement.
  // (Different engagement → 403 — mirrors the contract's `NotEngagementClient`
  // revert.)
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: offer.engagementId },
  });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.clientUserId !== me.id) {
    return NextResponse.json(
      { error: { code: "NotEngagementClient", message: "Only the engagement's client may fund this offer." } },
      { status: 403 },
    );
  }

  // Drive the chain. fundProposal recovers the lawyer's typed-data signature
  // again (defense in depth — the offer was already verified at POST time,
  // but the chain layer is the canonical source of truth). It will also burn
  // the nonce + create the Proposal row inside its own transaction.
  let chainResult: { proposalIndex: number; txHash: string };
  try {
    chainResult = await fundProposal({
      engagementId: offer.engagementId,
      amountWei: offer.amountWei,
      valueWei: offer.amountWei,
      itemsHash: offer.itemsHash,
      nonce: offer.nonce,
      lawyerOfferSig: offer.lawyerSig,
      from: me.walletAddress,
    });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }

  const updated = await prisma.proposalOffer.update({
    where: { id: offer.id },
    data: {
      consumedAt: new Date(),
      consumedTxHash: chainResult.txHash,
      consumedProposalIndex: chainResult.proposalIndex,
    },
  });

  return NextResponse.json({
    proposalIndex: chainResult.proposalIndex,
    txHash: chainResult.txHash,
    offer: {
      id: updated.id,
      consumedAt: updated.consumedAt?.toISOString() ?? null,
      consumedTxHash: updated.consumedTxHash,
      consumedProposalIndex: updated.consumedProposalIndex,
    },
  });
}
