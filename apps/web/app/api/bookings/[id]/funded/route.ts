import { NextRequest, NextResponse } from "next/server";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { matterRefFromBookingId, parseFundedReceipt } from "@/lib/web3/escrow";
import { publishBookingChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Confirm an on-chain `openEngagementAndFundFirstMilestone` tx submitted by
 * the client's wallet. Phase 6 moved escrow funding off the server (the
 * contract gates on msg.sender == client). The flow is:
 *
 *   1. Both parties' signatures already recorded in DB.
 *   2. Client's wallet calls `openEngagementAndFundFirstMilestone` directly
 *      via wagmi useWriteContract (with value: amount).
 *   3. Once the tx confirms, the client calls THIS endpoint with the txHash.
 *
 * The server fetches the receipt, parses EngagementOpened + MilestoneFunded,
 * validates that the parties + amount + matterRef match this booking, and
 * advances the booking to ACCEPTED with the engagementId persisted.
 *
 * Why server-side verification at all? The booking state machine drives
 * downstream UI (consultation join, release flow, dispute path). We could
 * instead derive everything from chain state, but that requires either an
 * indexer (Phase 11) or per-page on-chain reads. Storing a single
 * server-confirmed engagementId on the booking row keeps Phase 6 small.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { txHash?: string };
  const txHash = body.txHash;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: { include: { user: true } }, client: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.engagementId) {
    // Idempotent — the client may have retried after a flaky network.
    return NextResponse.json({ booking });
  }
  if (!booking.clientAcceptedAt || !booking.lawyerAcceptedAt) {
    return NextResponse.json(
      { error: "Both signatures required before funding can be confirmed." },
      { status: 409 },
    );
  }

  const expectedClient = booking.client.walletAddress.toLowerCase();
  const expectedLawyer = booking.lawyerProfile.user.walletAddress.toLowerCase();
  if (!isAddress(expectedClient) || !isAddress(expectedLawyer)) {
    return NextResponse.json({ error: "Booking parties have invalid wallet addresses." }, { status: 500 });
  }

  // The escrow holds only `consultationFeeEUR` — the amount the lawyer
  // receives on release. The current contract's `releaseMilestone` sends
  // 100% of the milestone to the lawyer, so funding the platform-fee on top
  // would tip it to the lawyer too. The platform fee remains a display-only
  // line item in the UI until a contract change adds a real split.
  const lawyerFeeEth = Number(booking.consultationFeeEUR);
  if (!(lawyerFeeEth > 0)) {
    return NextResponse.json({ error: "Booking has zero fee — nothing to fund." }, { status: 400 });
  }
  const expectedAmountWei = parseEther(lawyerFeeEth.toFixed(18));

  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable — is the chain reachable?" }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Funding tx reverted on chain." }, { status: 400 });
  }

  const escrow = getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS.toLowerCase();
  if (receipt.to?.toLowerCase() !== escrow) {
    return NextResponse.json(
      { error: `Tx target ${receipt.to} is not the escrow contract.` },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseFundedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse escrow events: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const eventClient = (parsed.client as Address).toLowerCase();
  const eventLawyer = (parsed.lawyer as Address).toLowerCase();
  if (eventClient !== expectedClient) {
    return NextResponse.json(
      { error: `Tx client ${eventClient} does not match booking client ${expectedClient}.` },
      { status: 400 },
    );
  }
  if (eventLawyer !== expectedLawyer) {
    return NextResponse.json(
      { error: `Tx lawyer ${eventLawyer} does not match booking lawyer ${expectedLawyer}.` },
      { status: 400 },
    );
  }

  const expectedMatterRef = matterRefFromBookingId(booking.id);
  if ((parsed.matterRef as string).toLowerCase() !== expectedMatterRef.toLowerCase()) {
    return NextResponse.json(
      { error: "matterRef does not match this booking — refusing to bind." },
      { status: 400 },
    );
  }
  if (parsed.amount !== expectedAmountWei) {
    return NextResponse.json(
      {
        error: `Funded amount ${parsed.amount.toString()} wei does not match expected ${expectedAmountWei.toString()} wei.`,
      },
      { status: 400 },
    );
  }

  // engagementIdOnChain fits comfortably in a 32-bit int for the foreseeable
  // future (uint256 from chain, stored as Int — caps around 2^31). If we ever
  // exceed that we'll migrate to a string column; bail explicitly if it happens.
  if (parsed.engagementId > 2_000_000_000n) {
    return NextResponse.json({ error: "engagementId exceeds Int32 range" }, { status: 500 });
  }

  // Open the Engagement row + link the Booking atomically. The Engagement is
  // the parent of follow-up Orders (Phase 8) — without it created here, the
  // lawyer can't drop additional orders on the same matter.
  const updated = await prisma.$transaction(async (tx) => {
    const engagement = await tx.engagement.create({
      data: {
        clientId: booking.clientId,
        lawyerProfileId: booking.lawyerProfileId,
        matterRef: expectedMatterRef.toLowerCase(),
        engagementIdOnChain: Number(parsed.engagementId),
      },
    });
    return tx.booking.update({
      where: { id },
      data: {
        status: BookingStatus.ACCEPTED,
        escrowTxHash: txHash,
        engagementId: engagement.id,
      },
    });
  });

  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
