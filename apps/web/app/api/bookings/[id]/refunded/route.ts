import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseRefundedReceipt } from "@/lib/web3/escrow";
import { publishBookingChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Either party submits the on-chain `mutualRefundMilestone` tx (after both
 * sigs are present) and posts the txHash here. Server fetches the receipt,
 * confirms the MilestoneMutuallyRefunded event matches this booking's
 * engagement + milestone 0, then updates the row.
 *
 * Symmetric to /api/bookings/[id]/funded and /released — same pattern,
 * different event name + terminal status.
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
  // Either party may post the txHash (whoever submitted the on-chain tx).
  const isParty = booking.clientId === me.id || booking.lawyerProfile.userId === me.id;
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!booking.engagement) {
    return NextResponse.json({ error: "Booking has no on-chain engagement." }, { status: 409 });
  }
  if (booking.escrowRefundHash) {
    return NextResponse.json({ booking }); // idempotent
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable — is the chain reachable?" }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Refund tx reverted on chain." }, { status: 400 });
  }
  const escrow = getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS.toLowerCase();
  if (receipt.to?.toLowerCase() !== escrow) {
    return NextResponse.json({ error: `Tx target ${receipt.to} is not the escrow contract.` }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseRefundedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse refund event: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  if (Number(parsed.engagementId) !== booking.engagement.engagementIdOnChain) {
    return NextResponse.json(
      { error: `Refund engagement ${parsed.engagementId} does not match this booking's engagement ${booking.engagement.engagementIdOnChain}.` },
      { status: 400 },
    );
  }
  // Bookings are always milestone 0; orders take 1+.
  if (parsed.milestoneIndex !== 0n) {
    return NextResponse.json(
      { error: `Booking refund expects milestone 0; got ${parsed.milestoneIndex}.` },
      { status: 400 },
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.CANCELLED,
      escrowRefundHash: txHash,
    },
  });
  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
