import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, type Hex } from "viem";

import { milestoneOfferMessage, recoverSigner } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * V2 follow-up milestone funding (replaces the V1 propose-then-fund pair).
 * The client supplies the `offer_id` of an open `milestone_offers` row
 * (signed by either party); the server verifies that signature and the
 * offer's freshness, then returns calldata for
 * `fundMilestone(engagementId, amount)`. The contract creates the
 * milestone atomically at fund time — there is no separate proposal tx.
 *
 * The request path keeps `[milestoneIndex]` as a placeholder for URL
 * shape symmetry with the deliver/release/refund routes, but the value
 * is ignored: V2 doesn't know the on-chain index until the tx mines and
 * the indexer flips `milestone_offers.accepted_milestone_index`.
 */

const Schema = z.object({ offer_id: z.number().int().positive() }).strict();

interface OfferRow {
  id: number;
  engagement_id: number;
  proposer_address: string;
  amount_wei: string;
  note: string | null;
  nonce: string;
  signature: string;
  superseded_by: number | null;
  accepted_milestone_index: number | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string; milestoneIndex: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  let parsed: z.infer<typeof Schema>;
  try {
    parsed = Schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const db = getDb();
  const r = resolveEngagement(db, requestId, address);
  if (!r) {
    return NextResponse.json({ error: "engagement not opened yet" }, { status: 404 });
  }
  if (r.role !== "client") {
    return NextResponse.json({ error: "only the client can fund a milestone" }, { status: 403 });
  }
  if (r.engagement.state !== "active") {
    return NextResponse.json({ error: "engagement is closed" }, { status: 409 });
  }

  const offer = db
    .prepare(
      `SELECT id, engagement_id, proposer_address, amount_wei, note, nonce, signature,
              superseded_by, accepted_milestone_index
       FROM milestone_offers
       WHERE id = ? AND engagement_id = ?`
    )
    .get(parsed.offer_id, r.engagement.engagement_id) as OfferRow | undefined;
  if (!offer) {
    return NextResponse.json({ error: "offer not found" }, { status: 404 });
  }
  if (offer.superseded_by !== null || offer.accepted_milestone_index !== null) {
    return NextResponse.json(
      { error: "offer is no longer the active head" },
      { status: 409 }
    );
  }

  // Re-verify the proposer's signature server-side before issuing calldata.
  // The platform layer is the trust gate here; the V2 contract trusts the
  // amount the client funds, so a forged offer that slipped past
  // verification would be paid for by the client themselves — but defense
  // in depth is cheap.
  const canonical = milestoneOfferMessage({
    engagementId: offer.engagement_id,
    amountWei: offer.amount_wei,
    note: offer.note ?? "",
    nonce: offer.nonce,
  });
  let recovered: Address;
  try {
    recovered = await recoverSigner(canonical, offer.signature as Hex);
  } catch {
    return NextResponse.json({ error: "offer signature invalid" }, { status: 400 });
  }
  if (recovered.toLowerCase() !== offer.proposer_address.toLowerCase()) {
    return NextResponse.json({ error: "offer signer mismatch" }, { status: 400 });
  }

  const addrs = getAddresses();
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "fundMilestone",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), offer.amount_wei],
    value_wei: offer.amount_wei,
  };
  return NextResponse.json(out);
}
