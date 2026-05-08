import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { proposalMessage, verifyMessageSignature } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

/**
 * Counter-proposal — either party can post one once the chain has started
 * (FR-011). The new proposal must reference the current head (the row in
 * engagement_proposals with `superseded_by IS NULL`); on success the head is
 * marked superseded_by the new id, so the chain always has exactly one head.
 */
const CounterSchema = z
  .object({
    amount_wei: z.string().regex(/^[1-9]\d*$/, "decimal big-int wei (no leading zeros)"),
    note: z.string().max(500).optional(),
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
    prev_proposal_id: z.number().int().positive(),
  })
  .strict();

interface RequestRow {
  id: number;
  matter_id: number;
  client_address: string;
  lawyer_address: string;
  status: string;
}

interface ProposalRow {
  id: number;
  request_id: number;
  superseded_by: number | null;
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

  let parsed: z.infer<typeof CounterSchema>;
  try {
    parsed = CounterSchema.parse(await req.json());
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
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `request is ${request.status}, cannot counter` },
      { status: 409 }
    );
  }
  const isParty =
    request.client_address.toLowerCase() === address.toLowerCase() ||
    request.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json({ error: "not a party to this request" }, { status: 403 });
  }

  // The cited prev must be (a) on this request, (b) the current head.
  const prev = db
    .prepare(`SELECT id, request_id, superseded_by FROM engagement_proposals WHERE id = ?`)
    .get(parsed.prev_proposal_id) as ProposalRow | undefined;
  if (!prev || prev.request_id !== requestId) {
    return NextResponse.json(
      { error: "prev_proposal_id is not part of this request" },
      { status: 400 }
    );
  }
  if (prev.superseded_by !== null) {
    return NextResponse.json(
      { error: "prev_proposal_id is no longer the head of the chain" },
      { status: 409 }
    );
  }

  const message = proposalMessage({
    matterId: request.matter_id,
    amountWei: parsed.amount_wei,
    note: parsed.note ?? "",
    prevProposalId: parsed.prev_proposal_id,
  });
  let ok: boolean;
  try {
    ok = await verifyMessageSignature({
      address: address as Address,
      message,
      signature: parsed.signature as Hex,
    });
  } catch {
    ok = false;
  }
  if (!ok) {
    return NextResponse.json({ error: "signature does not match the SIWE-bound address" }, { status: 400 });
  }

  const newId = db.transaction(() => {
    const ins = db
      .prepare(
        `INSERT INTO engagement_proposals
           (matter_id, request_id, lawyer_address, proposer_address, amount_wei,
            note, signature, prev_proposal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.matter_id,
        requestId,
        request.lawyer_address,
        address,
        parsed.amount_wei,
        parsed.note ?? null,
        parsed.signature,
        parsed.prev_proposal_id,
        Math.floor(Date.now() / 1000)
      );
    const id = Number(ins.lastInsertRowid);
    db.prepare(`UPDATE engagement_proposals SET superseded_by = ? WHERE id = ?`).run(
      id,
      parsed.prev_proposal_id
    );
    return id;
  })();

  // Notify engagement page + both inbox/matters via the wallet channels.
  emitForRequest(
    {
      kind: "proposal",
      request_id: requestId,
      engagement_id: null,
      detail: { proposal_id: newId, proposer: address, supersedes: parsed.prev_proposal_id },
    },
    { client_address: request.client_address, lawyer_address: request.lawyer_address }
  );

  return NextResponse.json({
    ok: true,
    proposal: {
      id: newId,
      request_id: requestId,
      proposer_address: address,
      amount_wei: parsed.amount_wei,
      note: parsed.note ?? null,
      prev_proposal_id: parsed.prev_proposal_id,
    },
  });
}
