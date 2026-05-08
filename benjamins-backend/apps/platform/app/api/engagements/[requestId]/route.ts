import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

interface RequestRow {
  id: number;
  matter_id: number;
  client_address: string;
  lawyer_address: string;
  status: "pending" | "declined" | "accepted" | "withdrawn";
  created_at: number;
}

interface MatterRow {
  id: number;
  description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  status: string;
}

interface ProposalRow {
  id: number;
  matter_id: number;
  request_id: number;
  lawyer_address: string;
  proposer_address: string;
  amount_wei: string;
  note: string | null;
  signature: string;
  prev_proposal_id: number | null;
  superseded_by: number | null;
  created_at: number;
}

/**
 * Returns a request's full state — matter + proposal chain + counterparty
 * disclosure subset — to either of its parties. Used by both the lawyer inbox
 * detail UI and the client-side engagement page (Group D2).
 */
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
  const request = db
    .prepare(`SELECT * FROM engagement_requests WHERE id = ?`)
    .get(requestId) as RequestRow | undefined;
  if (!request) {
    return NextResponse.json({ error: "request not found" }, { status: 404 });
  }

  const isParty =
    request.client_address.toLowerCase() === address.toLowerCase() ||
    request.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json(
      { error: "not a party to this engagement request" },
      { status: 403 }
    );
  }

  const matter = db
    .prepare(`SELECT id, description, target_jurisdiction, target_practice_area, status FROM matters WHERE id = ?`)
    .get(request.matter_id) as MatterRow;

  const proposals = db
    .prepare(
      `SELECT id, matter_id, request_id, lawyer_address, proposer_address, amount_wei,
              note, signature, prev_proposal_id, superseded_by, created_at
       FROM engagement_proposals
       WHERE request_id = ?
       ORDER BY id ASC`
    )
    .all(requestId) as ProposalRow[];

  // Group F: milestones from the on-chain mirror. Engagement may not have
  // an off-chain row yet (still pending pre-fund), in which case the list
  // is empty and the page will fall back to the negotiation card.
  const offChain = db
    .prepare(
      `SELECT engagement_id, current_transcript_root, last_anchor_block, state
       FROM engagement_off_chain WHERE request_id = ?`
    )
    .get(requestId) as
    | {
        engagement_id: number;
        current_transcript_root: string;
        last_anchor_block: number;
        state: string;
      }
    | undefined;
  const milestones = offChain
    ? (db
        .prepare(
          `SELECT milestone_index, amount_wei, state, delivered_at
           FROM milestones WHERE engagement_id = ? ORDER BY milestone_index`
        )
        .all(offChain.engagement_id) as Array<{
        milestone_index: number;
        amount_wei: string;
        state: string;
        delivered_at: number | null;
      }>)
    : [];

  // Counterparty disclosure subset (FR-029 / FR-003). The lawyer sees the
  // client's country + age-over-18 only. The client has no disclosed-attribute
  // restriction symmetrical to that, but lawyer disclosed_attrs are a public
  // profile field anyway (jurisdiction, bar admission number, etc.).
  const counterparty =
    request.client_address.toLowerCase() === address.toLowerCase()
      ? request.lawyer_address
      : request.client_address;
  const counterpartyRow = db
    .prepare(
      `SELECT attested_role, disclosed_attrs FROM verified_users
       WHERE lower(eth_address) = lower(?)
       ORDER BY attested_role DESC LIMIT 1`
    )
    .get(counterparty) as { attested_role: string; disclosed_attrs: string } | undefined;

  return NextResponse.json({
    request,
    matter,
    proposals,
    head_proposal_id: proposals.find((p) => p.superseded_by === null)?.id ?? null,
    counterparty: counterpartyRow
      ? {
          address: counterparty,
          attested_role: counterpartyRow.attested_role,
          disclosed_attrs: JSON.parse(counterpartyRow.disclosed_attrs),
        }
      : { address: counterparty, attested_role: null, disclosed_attrs: {} },
    engagement: offChain
      ? {
          engagement_id: offChain.engagement_id,
          current_transcript_root: offChain.current_transcript_root,
          last_anchor_block: offChain.last_anchor_block,
          state: offChain.state,
        }
      : null,
    milestones,
  });
}
