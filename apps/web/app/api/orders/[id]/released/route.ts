import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseReleasedReceipt } from "@/lib/web3/escrow";
import { publishOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Confirm an on-chain `releaseMilestone` tx for a follow-up Order. Symmetric
 * to /api/bookings/[id]/released but for milestones 1+. Verifies the
 * MilestoneReleased event matches the order's (engagementIdOnChain,
 * milestoneIndex), then sets escrowReleaseHash + status=COMPLETED.
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
  if (order.escrowReleaseHash) {
    return NextResponse.json({ order }); // idempotent
  }
  if (order.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: `Order is ${order.status} — release expects ACCEPTED.` },
      { status: 409 },
    );
  }
  if (order.milestoneIndex === null || order.milestoneIndex === undefined) {
    return NextResponse.json(
      { error: "Order has no milestoneIndex — fund first." },
      { status: 409 },
    );
  }

  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable — is the chain reachable?" }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Release tx reverted on chain." }, { status: 400 });
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
    parsed = parseReleasedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse release event: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  if (Number(parsed.engagementId) !== order.engagement.engagementIdOnChain) {
    return NextResponse.json(
      {
        error: `Release engagement ${parsed.engagementId} does not match order engagement ${order.engagement.engagementIdOnChain}.`,
      },
      { status: 400 },
    );
  }
  if (Number(parsed.milestoneIndex) !== order.milestoneIndex) {
    return NextResponse.json(
      {
        error: `Release milestone ${parsed.milestoneIndex} does not match order milestone ${order.milestoneIndex}.`,
      },
      { status: 400 },
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "COMPLETED",
      escrowReleaseHash: txHash,
    },
  });

  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
