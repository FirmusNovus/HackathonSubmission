import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { milestoneOfferMessage, recoverSigner } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { resolveEngagement } from "@/lib/engagement-resolve";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

/**
 * V2 follow-up milestone offers (replaces the V1 on-chain `proposeMilestone`
 * tx). Either party can POST a wallet-signed `MilestoneOffer`; we verify the
 * signature, supersede the previous open offer for this engagement, and
 * persist a new row. The client materializes one of these by funding it
 * via `POST /milestones/[index]/fund-calldata`.
 *
 * Note: the first milestone is still negotiated through the pre-engagement
 * `engagement_proposals` table — that flow happens before any on-chain
 * action exists. This route covers post-funding follow-ups only.
 */
const Schema = z
  .object({
    amount_wei: z.string().regex(/^[1-9]\d*$/, "decimal big-int wei"),
    note: z.string().max(500).optional(),
    nonce: z.string().min(1),
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
  })
  .strict();

interface OpenOfferRow {
  id: number;
}

export async function POST(req: NextRequest, { params }: { params: { requestId: string } }) {
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
  if (r.role === "none") {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }
  if (r.engagement.state !== "active") {
    return NextResponse.json({ error: "engagement is closed" }, { status: 409 });
  }

  // Verify the signature against the canonical message before persisting.
  // The proposer is whoever signed it — we recover their address rather
  // than trusting a body field, then check it matches the SIWE-bound caller.
  const canonical = milestoneOfferMessage({
    engagementId: r.engagement.engagement_id,
    amountWei: parsed.amount_wei,
    note: parsed.note ?? "",
    nonce: parsed.nonce,
  });
  let recovered: Address;
  try {
    recovered = await recoverSigner(canonical, parsed.signature as Hex);
  } catch {
    return NextResponse.json({ error: "signature is malformed" }, { status: 400 });
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: "signature does not match SIWE-bound address" },
      { status: 403 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const result = db.transaction(() => {
    const open = db
      .prepare(
        `SELECT id FROM milestone_offers
         WHERE engagement_id = ? AND superseded_by IS NULL AND accepted_milestone_index IS NULL
         ORDER BY id DESC`
      )
      .all(r.engagement.engagement_id) as OpenOfferRow[];
    const prevId: number | null = open[0]?.id ?? null;

    const inserted = db
      .prepare(
        `INSERT INTO milestone_offers
           (engagement_id, proposer_address, amount_wei, note, nonce, signature,
            prev_offer_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.engagement.engagement_id,
        recovered.toLowerCase(),
        parsed.amount_wei,
        parsed.note ?? null,
        parsed.nonce,
        parsed.signature,
        prevId,
        now
      );
    const newId = Number(inserted.lastInsertRowid);

    // Supersede every previously-open offer for this engagement (covers
    // both the chain head and any orphaned siblings — defensive).
    if (open.length > 0) {
      const stmt = db.prepare(`UPDATE milestone_offers SET superseded_by = ? WHERE id = ?`);
      for (const row of open) stmt.run(newId, row.id);
    }
    return { newId, prevId };
  })();

  // Event for the engagement page so the counterparty's "active offer" card
  // refreshes without a manual reload.
  emitForRequest(
    {
      kind: "proposal",
      request_id: requestId,
      engagement_id: r.engagement.engagement_id,
      detail: { offer_id: result.newId, kind: "milestone_offer" },
    },
    { client_address: r.engagement.client_address, lawyer_address: r.engagement.lawyer_address }
  );

  return NextResponse.json({
    ok: true,
    offer: {
      id: result.newId,
      engagement_id: r.engagement.engagement_id,
      proposer_address: recovered.toLowerCase(),
      amount_wei: parsed.amount_wei,
      note: parsed.note ?? null,
      nonce: parsed.nonce,
      prev_offer_id: result.prevId,
      created_at: now,
    },
  });
}

export async function GET(_req: Request, { params }: { params: { requestId: string } }) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  const db = getDb();
  const r = resolveEngagement(db, requestId, address);
  if (!r) {
    return NextResponse.json({ error: "engagement not opened yet" }, { status: 404 });
  }
  if (r.role === "none") {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  const rows = db
    .prepare(
      `SELECT id, proposer_address, amount_wei, note, nonce, signature,
              prev_offer_id, superseded_by, accepted_milestone_index, created_at
       FROM milestone_offers
       WHERE engagement_id = ?
       ORDER BY id ASC`
    )
    .all(r.engagement.engagement_id);

  return NextResponse.json({ offers: rows });
}
