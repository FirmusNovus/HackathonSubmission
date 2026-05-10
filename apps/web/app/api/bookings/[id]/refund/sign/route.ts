import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publishBookingChanged } from "@/lib/events/realtime";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import {
  REFUND_TYPES,
  buildRefundDomain,
  type RefundAuthorizationPayload,
} from "@/lib/web3/refund-eip712";

export const runtime = "nodejs";

/**
 * Either party (client or lawyer) signs an EIP-712 MutualRefundAuthorization
 * for the consultation milestone (milestone 0 of the engagement). The first
 * call from one party stores their sig + sets refundProposedBy; the second
 * call from the other party stores the second sig. Once both are present
 * the on-chain `mutualRefundMilestone` tx can be submitted from either
 * party's wallet and confirmed via /api/bookings/[id]/refunded.
 *
 * The typed-data domain MUST match the contract's
 * `EIP712("LexNovaEscrow", "1")`, otherwise on-chain signer recovery
 * returns the wrong address and the tx reverts. See lib/web3/refund-eip712.ts.
 */
const SignSchema = z.object({
  // Optional only for dev-login fixture sessions which have no real wallet
  // to sign with. Real (SIWE) sessions must include a sig.
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

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { engagement: true, lawyerProfile: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!booking.engagement) {
    return NextResponse.json({ error: "Booking has no on-chain engagement — nothing to refund." }, { status: 409 });
  }
  if (booking.escrowReleaseHash) {
    return NextResponse.json({ error: "Funds already released — refund not possible." }, { status: 409 });
  }
  if (booking.escrowRefundHash) {
    return NextResponse.json({ booking }); // already refunded — idempotent
  }

  const isClient = me.role === Role.CLIENT && booking.clientId === me.id;
  const isLawyer = me.role === Role.LAWYER && booking.lawyerProfile.userId === me.id;
  if (!isClient && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify the sig recovers to the calling user's wallet against the
  // contract's domain. The chain will do the same recovery later when
  // mutualRefundMilestone runs; doing it here too means we never store a
  // junk sig that would just revert on chain. Dev-login fixture sessions
  // (Playwright + smoke scripts) have no private key for their fake
  // 0x1111… addresses, so we skip the check for them — `escrowRefundHash`
  // can never get set without a real on-chain tx anyway.
  const callerWallet = me.walletAddress as Address;
  const isDevLogin = me.devLogin === true;
  if (!isDevLogin) {
    if (!parsed.data.signature) {
      return NextResponse.json({ error: "Wallet signature required." }, { status: 400 });
    }
    const message: RefundAuthorizationPayload = {
      engagementId: BigInt(booking.engagement.engagementIdOnChain),
      milestoneIndex: 0n,
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
  // Dev-login: store a placeholder so we can detect "this party signed" via
  // the boolean column flags, even though the value won't recover to the
  // real wallet on chain.
  const sigToStore = parsed.data.signature ?? (isDevLogin ? "0xdev" : null);
  if (isClient) data.clientRefundSignature = sigToStore;
  else data.lawyerRefundSignature = sigToStore;
  // First party to sign claims `refundProposedBy`. Second party leaves it.
  if (!booking.refundProposedAt) {
    data.refundProposedAt = new Date();
    data.refundProposedBy = isClient ? "CLIENT" : "LAWYER";
  }

  const updated = await prisma.booking.update({ where: { id }, data });
  publishBookingChanged(id);
  // Echo both sigs back when both are present, so the second signer can
  // submit `mutualRefundMilestone(eid, msIdx, clientSig, lawyerSig)`
  // immediately without an extra round-trip. The sigs aren't secret — the
  // contract verifies them in plain calldata — so exposing them to either
  // party of the engagement is fine.
  const bothSigsPresent = Boolean(updated.clientRefundSignature && updated.lawyerRefundSignature);
  return NextResponse.json({
    booking: updated,
    bothSigsPresent,
    clientSig: bothSigsPresent ? updated.clientRefundSignature : null,
    lawyerSig: bothSigsPresent ? updated.lawyerRefundSignature : null,
  });
}
