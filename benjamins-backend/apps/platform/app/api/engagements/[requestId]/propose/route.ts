import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { proposalMessage, verifyMessageSignature } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

/**
 * Initial proposal from the lawyer (T057 / FR-011).
 *
 * The lawyer signs `proposalMessage({matterId, amountWei, note, prevProposalId: null})`
 * with their wallet key; this route verifies the signature against the lawyer
 * address recorded on the engagement_request before persisting. The server
 * never holds the lawyer's private key — viem.verifyMessage round-trips
 * recovery + comparison.
 *
 * Counters (after either party has at least one proposal on file) go through
 * the sibling /counter route.
 */
const ProposeSchema = z
  .object({
    amount_wei: z.string().regex(/^[1-9]\d*$/, "decimal big-int wei (no leading zeros)"),
    note: z.string().max(500).optional(),
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
  })
  .strict();

interface RequestRow {
  id: number;
  matter_id: number;
  client_address: string;
  lawyer_address: string;
  status: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  let parsed: z.infer<typeof ProposeSchema>;
  try {
    parsed = ProposeSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const db = getDb();
  const request = db
    .prepare(`SELECT id, matter_id, client_address, lawyer_address, status FROM engagement_requests WHERE id = ?`)
    .get(requestId) as RequestRow | undefined;
  if (!request) {
    return NextResponse.json({ error: "request not found" }, { status: 404 });
  }
  if (request.lawyer_address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: "only the requested lawyer can post the initial proposal" },
      { status: 403 }
    );
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `request is ${request.status}, cannot propose` },
      { status: 409 }
    );
  }

  // Initial proposal only — counters go through /counter and need a prev row.
  const existing = db
    .prepare(`SELECT id FROM engagement_proposals WHERE request_id = ? LIMIT 1`)
    .get(requestId);
  if (existing) {
    return NextResponse.json(
      { error: "proposal chain already started; use /counter for further offers" },
      { status: 409 }
    );
  }

  const message = proposalMessage({
    matterId: request.matter_id,
    amountWei: parsed.amount_wei,
    note: parsed.note ?? "",
    prevProposalId: null,
  });
  let ok: boolean;
  try {
    ok = await verifyMessageSignature({
      address: address as Address,
      message,
      signature: parsed.signature as Hex,
    });
  } catch {
    // viem throws on malformed sigs (wrong length, garbage bytes) rather than
    // returning false. Treat that as a bad-input failure, not a 500.
    ok = false;
  }
  if (!ok) {
    return NextResponse.json({ error: "signature does not match the SIWE-bound address" }, { status: 400 });
  }

  const result = db
    .prepare(
      `INSERT INTO engagement_proposals
         (matter_id, request_id, lawyer_address, proposer_address, amount_wei,
          note, signature, prev_proposal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      request.matter_id,
      requestId,
      request.lawyer_address,
      address,
      parsed.amount_wei,
      parsed.note ?? null,
      parsed.signature,
      Math.floor(Date.now() / 1000)
    );

  // Notify open SSE subscribers — engagement page via the request channel,
  // both inboxes/matters via the wallet channels.
  emitForRequest(
    {
      kind: "proposal",
      request_id: requestId,
      engagement_id: null,
      detail: { proposal_id: Number(result.lastInsertRowid), proposer: address },
    },
    { client_address: request.client_address, lawyer_address: request.lawyer_address }
  );

  return NextResponse.json({
    ok: true,
    proposal: {
      id: Number(result.lastInsertRowid),
      request_id: requestId,
      matter_id: request.matter_id,
      proposer_address: address,
      amount_wei: parsed.amount_wei,
      note: parsed.note ?? null,
    },
  });
}
