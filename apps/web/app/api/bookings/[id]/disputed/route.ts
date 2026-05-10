import { NextRequest, NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseDisputedReceipt } from "@/lib/web3/escrow";
import { publishBookingChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Either party submits the on-chain `disputeMilestone` (client) or
 * `escalateMilestone` (lawyer + 30d cooldown) tx hash here. Server fetches
 * the receipt, parses the MilestoneDisputed event, validates the
 * engagement + milestone match, and flips the booking to DISPUTED.
 *
 * From here both parties get the "Submit your archive to the arbiter"
 * prompt and the operator sees the dispute on /admin/dashboard.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { txHash?: string };
  const txHash = body.txHash;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { engagement: true, lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    (me.role === Role.CLIENT && booking.clientId === me.id) ||
    (me.role === Role.LAWYER && booking.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!booking.engagement) {
    return NextResponse.json({ error: "Booking has no on-chain engagement." }, { status: 409 });
  }
  if (booking.status === BookingStatus.DISPUTED) {
    return NextResponse.json({ booking }); // idempotent
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable." }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Dispute tx reverted on chain." }, { status: 400 });
  }
  const escrow = getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS.toLowerCase();
  if (receipt.to?.toLowerCase() !== escrow) {
    return NextResponse.json({ error: `Tx target ${receipt.to} is not the escrow contract.` }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseDisputedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse dispute event: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  if (Number(parsed.engagementId) !== booking.engagement.engagementIdOnChain) {
    return NextResponse.json(
      { error: `Dispute engagement ${parsed.engagementId} does not match this booking's ${booking.engagement.engagementIdOnChain}.` },
      { status: 400 },
    );
  }
  if (parsed.milestoneIndex !== 0n) {
    return NextResponse.json(
      { error: `Booking dispute expects milestone 0; got ${parsed.milestoneIndex}.` },
      { status: 400 },
    );
  }

  // The on-chain `by` address tells us which side opened the dispute. Cross-
  // check it matches the caller's wallet.
  const callerWallet = me.walletAddress.toLowerCase();
  if ((parsed.by as Address).toLowerCase() !== callerWallet) {
    return NextResponse.json(
      { error: `Dispute opened by ${parsed.by}, not the calling wallet ${callerWallet}.` },
      { status: 400 },
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.DISPUTED,
      disputedAt: new Date(),
      disputeOpenedBy: me.role,
      disputeOpenTxHash: txHash,
    },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
