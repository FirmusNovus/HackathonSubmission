import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishOrderChanged } from "@/lib/events/realtime";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import {
  REFUND_TYPES,
  buildRefundDomain,
  type RefundAuthorizationPayload,
} from "@/lib/web3/refund-eip712";

export const runtime = "nodejs";

/**
 * Symmetric to /api/bookings/[id]/refund/sign but for follow-up Order
 * milestones (milestoneIndex 1+). The order must already be funded
 * (status === ACCEPTED, milestoneIndex set) and not yet released or
 * refunded.
 */
const SignSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = SignSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: { engagement: { include: { lawyerProfile: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.milestoneIndex === null) {
    return NextResponse.json({ error: "Order not yet funded — nothing to refund." }, { status: 409 });
  }
  if (order.escrowReleaseHash) {
    return NextResponse.json({ error: "Funds already released — refund not possible." }, { status: 409 });
  }
  if (order.escrowRefundHash) {
    return NextResponse.json({ order });
  }

  const isClient = me.role === Role.CLIENT && order.engagement.clientId === me.id;
  const isLawyer = me.role === Role.LAWYER && order.engagement.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const callerWallet = me.walletAddress as Address;
  const isDevLogin = me.devLogin === true;
  if (!isDevLogin) {
    if (!parsed.data.signature) {
      return NextResponse.json({ error: "Wallet signature required." }, { status: 400 });
    }
    const message: RefundAuthorizationPayload = {
      engagementId: BigInt(order.engagement.engagementIdOnChain),
      milestoneIndex: BigInt(order.milestoneIndex),
    };
    const domain = buildRefundDomain({
      chainId: getChainId(),
      verifyingContract: getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    });
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: REFUND_TYPES,
        primaryType: "MutualRefundAuthorization",
        message,
        signature: parsed.data.signature as Hex,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not recover signer: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    if (recovered.toLowerCase() !== callerWallet.toLowerCase()) {
      return NextResponse.json(
        { error: `Signature was made by ${recovered}, not your wallet ${callerWallet}.` },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  const sigToStore = parsed.data.signature ?? (isDevLogin ? "0xdev" : null);
  if (isClient) data.clientRefundSignature = sigToStore;
  else data.lawyerRefundSignature = sigToStore;
  if (!order.refundProposedAt) {
    data.refundProposedAt = new Date();
    data.refundProposedBy = isClient ? "CLIENT" : "LAWYER";
  }

  const updated = await prisma.order.update({ where: { id }, data });
  publishOrderChanged(id);
  const bothSigsPresent = Boolean(updated.clientRefundSignature && updated.lawyerRefundSignature);
  return NextResponse.json({
    order: updated,
    bothSigsPresent,
    clientSig: bothSigsPresent ? updated.clientRefundSignature : null,
    lawyerSig: bothSigsPresent ? updated.lawyerRefundSignature : null,
  });
}
