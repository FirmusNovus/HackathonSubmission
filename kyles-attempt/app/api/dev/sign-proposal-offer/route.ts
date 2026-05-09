// =============================================================================
// /api/dev/sign-proposal-offer
// -----------------------------------------------------------------------------
// Dev/test-only EIP-712 signer. Returns 404 in production. Real wallets sign
// in the browser via wagmi's `useSignTypedData`; this route exists so the
// seeded personas (whose `0x1111…` / `0x2222…` addresses don't recover from
// any real private key) can produce verifiable typed-data signatures from
// their server-side derived dev key.
//
// The lawyer must be SIWE-signed in. We derive the deterministic dev
// private key from their wallet, sign the canonical (engagementId, amount,
// itemsHash, nonce) typed-data, and return the signature. The matching
// public address is `User.devSignerAddress`.
// =============================================================================

import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { Role } from "@/lib/db/enums";
import { getCurrentUser } from "@/lib/auth/session";
import {
  canonicalItemsHash,
  devPrivateKeyForWallet,
  generateOfferNonce,
  signProposalOffer,
} from "@/lib/chain/eip712";

const HEX_BYTES32 = /^0x[0-9a-fA-F]{64}$/;

const Schema = z.object({
  engagementId: z.number().int().positive(),
  amountWei: z.string().regex(/^[1-9]\d*$/, "decimal big-int wei (positive)"),
  // Caller may pre-compute the items hash + nonce client-side OR send the
  // raw items/deliverables and let the server derive both. Both surfaces
  // are useful: the form already has the items, so deriving server-side
  // keeps the client thin.
  itemsHash: z.string().regex(HEX_BYTES32).optional(),
  nonce: z.string().regex(HEX_BYTES32).optional(),
  items: z.array(z.unknown()).optional(),
  deliverables: z.array(z.unknown()).optional(),
});

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function POST(request: Request) {
  const guard = devGuard();
  if (guard) return guard;

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
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Derive itemsHash if not supplied. The caller MUST send (items,
  // deliverables) when itemsHash is absent — they're equivalent surfaces.
  let itemsHash: Hex;
  if (input.itemsHash) {
    itemsHash = input.itemsHash as Hex;
  } else if (input.items && input.deliverables) {
    itemsHash = canonicalItemsHash(input.items, input.deliverables);
  } else {
    return NextResponse.json(
      { error: "Provide either { itemsHash } or { items, deliverables }." },
      { status: 400 },
    );
  }

  const nonce: Hex = (input.nonce as Hex | undefined) ?? generateOfferNonce();
  const amountWei = BigInt(input.amountWei);

  const privateKey = devPrivateKeyForWallet(me.walletAddress);
  const { signature } = await signProposalOffer({
    privateKey,
    message: {
      engagementId: BigInt(input.engagementId),
      amount: amountWei,
      itemsHash,
      nonce,
    },
  });

  return NextResponse.json({
    signature,
    nonce,
    itemsHash,
    amountWei: amountWei.toString(10),
    devSignerAddress: me.devSignerAddress,
  });
}
