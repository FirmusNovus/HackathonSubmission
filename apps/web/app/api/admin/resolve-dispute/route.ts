import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatEther, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseResolvedReceipt } from "@/lib/web3/escrow";
import { publishBookingChanged, publishOrderChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Operator submits the on-chain `resolveDispute(...)` tx and posts the
 * txHash here. Server fetches the receipt, parses the MilestoneResolved
 * event, validates engagement + milestone match the dispute target, and
 * stamps the resolution onto the booking/order row.
 *
 * Both the chain and the DB are updated atomically from the operator's
 * single submit click — same pattern as /funded, /released, /refunded.
 */
const ResolveSchema = z.object({
  kind: z.enum(["booking", "order"]),
  id: z.string().min(1),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.OPERATOR) {
    return NextResponse.json({ error: "Operator only" }, { status: 401 });
  }
  const parsed = ResolveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { kind, id, txHash } = parsed.data;

  // Resolve the on-chain receipt first; we need its event payload to know
  // both how much went to whom AND which (engagement, milestone) was
  // affected. The contract event is the source of truth for both the
  // chain id mapping and the split amounts.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable." }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Resolve tx reverted on chain." }, { status: 400 });
  }
  const escrow = getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS.toLowerCase();
  if (receipt.to?.toLowerCase() !== escrow) {
    return NextResponse.json(
      { error: `Tx target ${receipt.to} is not the escrow contract.` },
      { status: 400 },
    );
  }
  let parsedReceipt;
  try {
    parsedReceipt = parseResolvedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse MilestoneResolved event: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const toLawyerEth = Number(formatEther(parsedReceipt.toLawyer));
  const toClientEth = Number(formatEther(parsedReceipt.toClient));

  if (kind === "booking") {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { engagement: true },
    });
    if (!booking || !booking.engagement) {
      return NextResponse.json({ error: "Booking not found or no engagement." }, { status: 404 });
    }
    if (Number(parsedReceipt.engagementId) !== booking.engagement.engagementIdOnChain) {
      return NextResponse.json(
        { error: `Resolution engagement ${parsedReceipt.engagementId} doesn't match booking ${booking.engagement.engagementIdOnChain}.` },
        { status: 400 },
      );
    }
    if (parsedReceipt.milestoneIndex !== 0n) {
      return NextResponse.json({ error: "Booking dispute expects milestone 0." }, { status: 400 });
    }
    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: "COMPLETED", // milestone is no longer locked; chain state is Resolved(5)
        disputeResolvedAt: new Date(),
        disputeResolveTxHash: txHash,
        disputeAmountToLawyer: toLawyerEth,
        disputeAmountToClient: toClientEth,
      },
    });
    publishBookingChanged(id);
    return NextResponse.json({ booking: updated });
  }

  // Order branch.
  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (Number(parsedReceipt.engagementId) !== order.engagement.engagementIdOnChain) {
    return NextResponse.json(
      { error: `Resolution engagement ${parsedReceipt.engagementId} doesn't match order ${order.engagement.engagementIdOnChain}.` },
      { status: 400 },
    );
  }
  if (Number(parsedReceipt.milestoneIndex) !== order.milestoneIndex) {
    return NextResponse.json(
      { error: `Resolution milestone ${parsedReceipt.milestoneIndex} doesn't match order ${order.milestoneIndex}.` },
      { status: 400 },
    );
  }
  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "COMPLETED",
      disputeResolvedAt: new Date(),
      disputeResolveTxHash: txHash,
      disputeAmountToLawyer: toLawyerEth,
      disputeAmountToClient: toClientEth,
    },
  });
  publishOrderChanged(id);
  return NextResponse.json({ order: updated });
}
