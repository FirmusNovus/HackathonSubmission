import { NextRequest, NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseDisputedReceipt } from "@/lib/web3/escrow";
import { publishOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Symmetric to /api/bookings/[id]/disputed for follow-up Order milestones
 * (milestoneIndex 1+). Verifies the on-chain MilestoneDisputed event +
 * matches the order's engagement + milestoneIndex, then flips the order
 * to DISPUTED.
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
    (me.role === Role.CLIENT && order.engagement.clientId === me.id) ||
    (me.role === Role.LAWYER && order.engagement.lawyerProfile.userId === me.id);
  if (!isParty) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (order.milestoneIndex === null) {
    return NextResponse.json({ error: "Order not yet funded — nothing to dispute." }, { status: 409 });
  }
  if (order.status === "DISPUTED") {
    return NextResponse.json({ order }); // idempotent
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
  if (Number(parsed.engagementId) !== order.engagement.engagementIdOnChain) {
    return NextResponse.json(
      { error: `Dispute engagement ${parsed.engagementId} does not match this order's ${order.engagement.engagementIdOnChain}.` },
      { status: 400 },
    );
  }
  if (Number(parsed.milestoneIndex) !== order.milestoneIndex) {
    return NextResponse.json(
      { error: `Dispute milestone ${parsed.milestoneIndex} does not match order milestone ${order.milestoneIndex}.` },
      { status: 400 },
    );
  }
  const callerWallet = me.walletAddress.toLowerCase();
  if ((parsed.by as Address).toLowerCase() !== callerWallet) {
    return NextResponse.json(
      { error: `Dispute opened by ${parsed.by}, not the calling wallet ${callerWallet}.` },
      { status: 400 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "DISPUTED",
      disputedAt: new Date(),
      disputeOpenedBy: me.role,
      disputeOpenTxHash: txHash,
    },
  });
  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
