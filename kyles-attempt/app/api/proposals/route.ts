// =============================================================================
// /api/proposals
// -----------------------------------------------------------------------------
// POST: lawyer publishes a fresh, EIP-712-signed `ProposalOffer` for a
// follow-up proposal inside an existing engagement. The body MUST include
// the lawyer's signature over the canonical typed-data; the server recovers
// the signer and asserts it matches the engagement's lawyer (or the lawyer's
// dev-signer alias for seeded personas — see lib/chain/eip712.ts).
//
// GET: returns every offer (consumed + unconsumed) attached to the engagement
// the caller is a party to. Used by the consultation-room rail to surface
// pending offers and historical funded follow-ups.
// =============================================================================

import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  canonicalItemsHash,
  verifyProposalOfferSigForUser,
} from "@/lib/chain/eip712";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const HEX_BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_SIG = /^0x[0-9a-fA-F]{130}$/;

const LineItemSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  kind: z.enum(["hourly", "fixed"]),
  hours: z.number().nonnegative().optional(),
  ratePerHour: z.number().nonnegative().optional(),
  fixedPrice: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative(),
});

const DeliverableSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(240),
  description: z.string().max(500).optional(),
});

const CreateOfferSchema = z.object({
  engagementId: z.number().int().positive(),
  amountWei: z.string().regex(/^[1-9]\d*$/, "decimal big-int wei (positive)"),
  itemsHash: z.string().regex(HEX_BYTES32, "0x-prefixed 32-byte hex"),
  nonce: z.string().regex(HEX_BYTES32, "0x-prefixed 32-byte hex"),
  signature: z.string().regex(HEX_SIG, "0x-prefixed 65-byte hex"),
  items: z.array(LineItemSchema).min(1),
  deliverables: z.array(DeliverableSchema).min(1),
  note: z.string().max(2000).optional().nullable(),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateOfferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Re-derive the items hash server-side from the supplied (items, deliverables)
  // and assert it matches the body's claimed itemsHash. This pins the lawyer
  // to a specific bag of work — they can't lie about which items the digest
  // represents (which would let them swap line items post-signature).
  const derivedHash = canonicalItemsHash(input.items, input.deliverables);
  if (derivedHash.toLowerCase() !== input.itemsHash.toLowerCase()) {
    return NextResponse.json(
      { error: { code: "ItemsHashMismatch", message: "itemsHash does not match the canonical hash of items+deliverables." } },
      { status: 422 },
    );
  }

  // Re-derive the total amount from the line-item subtotals (× 100 → wei
  // mock convention) and assert it matches the body's claimed amountWei.
  // Same rationale as itemsHash — the server is the source of truth for
  // what the lawyer signed over.
  const totalEUR = input.items.reduce((s, li) => s + li.subtotal, 0);
  const expectedAmountWei = BigInt(Math.round(totalEUR * 100));
  if (BigInt(input.amountWei) !== expectedAmountWei) {
    return NextResponse.json(
      {
        error: {
          code: "AmountMismatch",
          message: `amountWei (${input.amountWei}) does not match line-items total (${expectedAmountWei.toString()}).`,
        },
      },
      { status: 422 },
    );
  }

  // Engagement must exist and the caller must be its lawyer.
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: input.engagementId },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }
  if (engagement.lawyerUserId !== me.id) {
    return NextResponse.json({ error: "Forbidden — only the engagement's lawyer may publish offers." }, { status: 403 });
  }
  if (engagement.state !== "ACTIVE") {
    return NextResponse.json({ error: "Engagement is closed." }, { status: 409 });
  }

  // Nonce uniqueness — both for the platform-side ProposalOffer table AND
  // for the on-chain ConsumedProposalNonce mirror. We pre-check here so the
  // lawyer gets a clean 409 rather than a generic 500 from the unique-index
  // violation; the actual fundProposal call also re-checks server-side.
  const existing = await prisma.proposalOffer.findUnique({ where: { nonce: input.nonce } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "NonceAlreadyUsed", message: "This offer nonce is already on file." } },
      { status: 409 },
    );
  }
  const consumed = await prisma.consumedProposalNonce.findUnique({ where: { nonce: input.nonce } });
  if (consumed) {
    return NextResponse.json(
      { error: { code: "NonceAlreadyUsed", message: "This nonce was already consumed on chain." } },
      { status: 409 },
    );
  }

  // Real EIP-712 recovery + assertion. `verifyProposalOfferSigForUser` accepts
  // recovery to either the canonical wallet OR the seeded dev-signer alias
  // so production wallets and seeded personas use the same code path.
  let recovered: string;
  try {
    const result = await verifyProposalOfferSigForUser({
      message: {
        engagementId: BigInt(input.engagementId),
        amount: BigInt(input.amountWei),
        itemsHash: input.itemsHash as Hex,
        nonce: input.nonce as Hex,
      },
      signature: input.signature as Hex,
      walletAddress: me.walletAddress,
      devSignerAddress: me.devSignerAddress,
    });
    recovered = result.recovered;
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json({ error: body }, { status });
    }
    throw err;
  }

  // The itemsJson stored alongside the offer is the canonical-sorted JSON
  // form — the bytes the SHA-256 hash was actually computed over. Storing
  // the canonical form (rather than the input's surface form) means the
  // consumer can re-derive the hash deterministically without trusting the
  // input's serialisation.
  const itemsJson = JSON.stringify({ items: input.items, deliverables: input.deliverables });

  const offer = await prisma.proposalOffer.create({
    data: {
      engagementId: input.engagementId,
      amountWei: input.amountWei,
      itemsHash: input.itemsHash.toLowerCase(),
      itemsJson,
      nonce: input.nonce.toLowerCase(),
      lawyerSig: input.signature,
      lawyerAddress: recovered.toLowerCase(),
      clientNote: input.note ?? null,
    },
  });

  return NextResponse.json({
    offer: {
      id: offer.id,
      engagementId: offer.engagementId,
      amountWei: offer.amountWei,
      itemsHash: offer.itemsHash,
      nonce: offer.nonce,
      lawyerSig: offer.lawyerSig,
      lawyerAddress: offer.lawyerAddress,
      clientNote: offer.clientNote,
      createdAt: offer.createdAt.toISOString(),
      consumedAt: null,
    },
  });
}

export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const engagementIdRaw = url.searchParams.get("engagementId");
  const engagementId = Number(engagementIdRaw);
  if (!Number.isInteger(engagementId) || engagementId <= 0) {
    return NextResponse.json({ error: "engagementId required" }, { status: 400 });
  }
  const engagement = await prisma.engagement.findUnique({ where: { engagementId } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.clientUserId !== me.id && engagement.lawyerUserId !== me.id) {
    return NextResponse.json({ error: "Forbidden — not a party to this engagement." }, { status: 403 });
  }
  const offers = await prisma.proposalOffer.findMany({
    where: { engagementId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    offers: offers.map((o) => ({
      id: o.id,
      engagementId: o.engagementId,
      amountWei: o.amountWei,
      itemsHash: o.itemsHash,
      itemsJson: o.itemsJson,
      nonce: o.nonce,
      lawyerSig: o.lawyerSig,
      lawyerAddress: o.lawyerAddress,
      clientNote: o.clientNote,
      createdAt: o.createdAt.toISOString(),
      consumedAt: o.consumedAt?.toISOString() ?? null,
      consumedTxHash: o.consumedTxHash,
      consumedProposalIndex: o.consumedProposalIndex,
    })),
  });
}
