import { NextRequest, NextResponse } from "next/server";
import { parseEther, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseFundMilestoneReceipt } from "@/lib/web3/escrow";
import { publishOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Confirm an on-chain `fundMilestone(engagementId, amount)` tx submitted by
 * the client's wallet for a follow-up Order. Symmetric to
 * /api/bookings/[id]/funded but for milestone 1+ (the consultation funded
 * milestone 0). Verifies that the funded amount + engagementId match the
 * Order, then advances the Order to ACCEPTED with milestoneIndex set.
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

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.engagement.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.status !== "REQUESTED") {
    return NextResponse.json(
      { error: `Order is ${order.status} — only REQUESTED orders can be funded.` },
      { status: 409 },
    );
  }

  const expectedAmountWei = parseEther(Number(order.amountETH).toFixed(18));

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
    parsed = parseFundMilestoneReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse MilestoneFunded event: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  if (Number(parsed.engagementId) !== order.engagement.engagementIdOnChain) {
    return NextResponse.json(
      {
        error: `Funded engagement ${parsed.engagementId} does not match this order's engagement ${order.engagement.engagementIdOnChain}.`,
      },
      { status: 400 },
    );
  }
  if (parsed.amount !== expectedAmountWei) {
    return NextResponse.json(
      {
        error: `Funded amount ${parsed.amount.toString()} wei does not match order amount ${expectedAmountWei.toString()} wei.`,
      },
      { status: 400 },
    );
  }
  // milestoneIndex must be > 0 (milestone 0 is the consultation booking).
  if (parsed.milestoneIndex < 1n) {
    return NextResponse.json(
      { error: `Order milestone must be 1+; got ${parsed.milestoneIndex}.` },
      { status: 400 },
    );
  }
  if (parsed.milestoneIndex > 2_000_000_000n) {
    return NextResponse.json({ error: "milestoneIndex exceeds Int32 range" }, { status: 500 });
  }

  // Defend against double-funding the same milestone via a different Order
  // record. The contract emits MilestoneFunded once per milestone; if another
  // Order already claimed this index, refuse.
  const existing = await prisma.order.findFirst({
    where: {
      engagementId: order.engagementId,
      milestoneIndex: Number(parsed.milestoneIndex),
    },
  });
  if (existing && existing.id !== order.id) {
    return NextResponse.json(
      {
        error: `Milestone ${parsed.milestoneIndex} on this engagement is already bound to order ${existing.id}.`,
      },
      { status: 409 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "ACCEPTED",
      escrowTxHash: txHash,
      milestoneIndex: Number(parsed.milestoneIndex),
    },
  });

  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
