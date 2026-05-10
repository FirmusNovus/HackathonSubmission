import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseEther, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import {
  ORDER_CREATE_TYPES,
  buildOrderDomain,
  hashOrderDescription,
  type OrderCreatePayload,
} from "@/lib/web3/order-eip712";

export const runtime = "nodejs";

const CreateOrderSchema = z.object({
  engagementId: z.string().min(1),
  description: z.string().min(1).max(2000),
  amountETH: z.number().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = CreateOrderSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: me.id } });
  if (!profile) {
    return NextResponse.json({ error: "You don't have a lawyer profile yet." }, { status: 400 });
  }

  const engagement = await prisma.engagement.findUnique({
    where: { id: parsed.data.engagementId },
  });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.lawyerProfileId !== profile.id) {
    return NextResponse.json({ error: "Forbidden — not your engagement" }, { status: 403 });
  }
  if (engagement.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `Engagement is ${engagement.status} — cannot add new orders.` },
      { status: 409 },
    );
  }

  const lawyerWallet = me.walletAddress as Address;
  const isDevLogin = me.devLogin === true;
  if (!isDevLogin) {
    if (!parsed.data.signature || !parsed.data.nonce) {
      return NextResponse.json({ error: "Wallet signature required." }, { status: 400 });
    }
    const amountWei = parseEther(parsed.data.amountETH.toFixed(18));
    const message: OrderCreatePayload = {
      lawyer: lawyerWallet,
      engagementId: engagement.id,
      engagementIdOnChain: BigInt(engagement.engagementIdOnChain),
      amountWei,
      descriptionHash: hashOrderDescription(parsed.data.description),
      nonce: parsed.data.nonce,
    };
    const domain = buildOrderDomain({
      chainId: getChainId(),
      verifyingContract: getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    });
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: ORDER_CREATE_TYPES,
        primaryType: "OrderCreate",
        message,
        signature: parsed.data.signature as Hex,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not recover signer: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    if (recovered.toLowerCase() !== lawyerWallet.toLowerCase()) {
      return NextResponse.json(
        { error: `Signature was made by ${recovered}, not the signed-in lawyer wallet ${lawyerWallet}.` },
        { status: 400 },
      );
    }
  }

  const order = await prisma.order.create({
    data: {
      engagementId: engagement.id,
      description: parsed.data.description,
      amountETH: parsed.data.amountETH,
      lawyerCreateSignature: parsed.data.signature ?? null,
      lawyerCreateNonce: parsed.data.nonce ?? null,
    },
  });

  return NextResponse.json({ order });
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const engagementId = url.searchParams.get("engagement");

  const baseFilter =
    me.role === Role.CLIENT
      ? { engagement: { clientId: me.id } }
      : { engagement: { lawyerProfile: { userId: me.id } } };

  const orders = await prisma.order.findMany({
    where: engagementId ? { ...baseFilter, engagementId } : baseFilter,
    include: { engagement: { include: { lawyerProfile: { include: { user: true } }, client: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ orders });
}
