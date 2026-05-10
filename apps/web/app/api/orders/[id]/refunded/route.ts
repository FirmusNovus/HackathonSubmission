import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseRefundedReceipt } from "@/lib/web3/escrow";
import { publishOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Symmetric to /api/bookings/[id]/refunded but for follow-up Order
 * milestones. Verifies the on-chain MilestoneMutuallyRefunded event
 * matches the order's engagement + milestoneIndex, then sets
 * escrowRefundHash + status=CANCELLED.
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

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isParty =
    order.engagement.clientId === me.id || order.engagement.lawyerProfile.userId === me.id;
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (order.escrowRefundHash) {
    return NextResponse.json({ order }); // idempotent
  }
  if (order.milestoneIndex === null) {
    return NextResponse.json({ error: "Order has no milestoneIndex." }, { status: 409 });
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
  if (Number(parsed.engagementId) !== order.engagement.engagementIdOnChain) {
    return NextResponse.json(
      { error: `Refund engagement ${parsed.engagementId} does not match this order's engagement ${order.engagement.engagementIdOnChain}.` },
      { status: 400 },
    );
  }
  if (Number(parsed.milestoneIndex) !== order.milestoneIndex) {
    return NextResponse.json(
      { error: `Refund milestone ${parsed.milestoneIndex} does not match order milestone ${order.milestoneIndex}.` },
      { status: 400 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "CANCELLED",
      escrowRefundHash: txHash,
    },
  });
  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
