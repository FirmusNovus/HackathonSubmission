// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export type ProposalState =
  | 'Issued'
  | 'Funded'
  | 'Delivered'
  | 'Released'
  | 'Disputed'
  | 'Resolved'
  | 'Refunded';

export interface ProposalRow {
  engagement_id: number;
  proposal_index: number;
  kind: 'CONSULTATION' | 'PROPOSAL';
  lawyer_address: string;
  total_wei: string;
  platform_fee_wei: string;
  line_items: Array<Record<string, unknown>>;
  deliverables: Array<Record<string, unknown>>;
  items_hash: string;
  nonce: string;
  lawyer_offer_signature: string;
  state: ProposalState;
  funded_tx_hash: string | null;
  delivered_tx_hash: string | null;
  delivered_at_block_timestamp: number | null;
  released_tx_hash: string | null;
  disputed_tx_hash: string | null;
  dispute_filed_by: string | null;
  resolved_tx_hash: string | null;
  amount_to_lawyer_wei: string | null;
  amount_to_client_wei: string | null;
  refunded_tx_hash: string | null;
  created_at: number;
  updated_at: number;
}

function deserialize(row: Record<string, unknown>): ProposalRow {
  return {
    ...(row as unknown as ProposalRow),
    line_items: JSON.parse((row.line_items as string) ?? '[]'),
    deliverables: JSON.parse((row.deliverables as string) ?? '[]'),
  };
}

export function upsertProposal(p: ProposalRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO proposals_off_chain (engagement_id, proposal_index, kind, lawyer_address, total_wei, platform_fee_wei, line_items, deliverables, items_hash, nonce, lawyer_offer_signature, state, funded_tx_hash, delivered_tx_hash, delivered_at_block_timestamp, released_tx_hash, disputed_tx_hash, dispute_filed_by, resolved_tx_hash, amount_to_lawyer_wei, amount_to_client_wei, refunded_tx_hash, created_at, updated_at)
     VALUES (@engagement_id, @proposal_index, @kind, @lawyer_address, @total_wei, @platform_fee_wei, @line_items, @deliverables, @items_hash, @nonce, @lawyer_offer_signature, @state, @funded_tx_hash, @delivered_tx_hash, @delivered_at_block_timestamp, @released_tx_hash, @disputed_tx_hash, @dispute_filed_by, @resolved_tx_hash, @amount_to_lawyer_wei, @amount_to_client_wei, @refunded_tx_hash, @created_at, @updated_at)
     ON CONFLICT(engagement_id, proposal_index) DO UPDATE SET
       state = excluded.state,
       funded_tx_hash = COALESCE(excluded.funded_tx_hash, proposals_off_chain.funded_tx_hash),
       delivered_tx_hash = COALESCE(excluded.delivered_tx_hash, proposals_off_chain.delivered_tx_hash),
       delivered_at_block_timestamp = COALESCE(excluded.delivered_at_block_timestamp, proposals_off_chain.delivered_at_block_timestamp),
       released_tx_hash = COALESCE(excluded.released_tx_hash, proposals_off_chain.released_tx_hash),
       disputed_tx_hash = COALESCE(excluded.disputed_tx_hash, proposals_off_chain.disputed_tx_hash),
       dispute_filed_by = COALESCE(excluded.dispute_filed_by, proposals_off_chain.dispute_filed_by),
       resolved_tx_hash = COALESCE(excluded.resolved_tx_hash, proposals_off_chain.resolved_tx_hash),
       amount_to_lawyer_wei = COALESCE(excluded.amount_to_lawyer_wei, proposals_off_chain.amount_to_lawyer_wei),
       amount_to_client_wei = COALESCE(excluded.amount_to_client_wei, proposals_off_chain.amount_to_client_wei),
       refunded_tx_hash = COALESCE(excluded.refunded_tx_hash, proposals_off_chain.refunded_tx_hash),
       updated_at = excluded.updated_at`,
  ).run({
    ...p,
    line_items: JSON.stringify(p.line_items),
    deliverables: JSON.stringify(p.deliverables),
    lawyer_address: p.lawyer_address.toLowerCase(),
  });
}

export function getProposal(engagementId: number, proposalIndex: number): ProposalRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM proposals_off_chain WHERE engagement_id = ? AND proposal_index = ?`)
    .get(engagementId, proposalIndex) as Record<string, unknown> | undefined;
  return row ? deserialize(row) : null;
}

export function listProposalsForEngagement(engagementId: number): ProposalRow[] {
  return (getDb()
    .prepare(`SELECT * FROM proposals_off_chain WHERE engagement_id = ? ORDER BY proposal_index ASC`)
    .all(engagementId) as Record<string, unknown>[]).map(deserialize);
}

export function setProposalState(
  engagementId: number,
  proposalIndex: number,
  state: ProposalState,
  extra: Partial<ProposalRow> = {},
): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE proposals_off_chain SET
       state = ?,
       funded_tx_hash = COALESCE(?, funded_tx_hash),
       delivered_tx_hash = COALESCE(?, delivered_tx_hash),
       delivered_at_block_timestamp = COALESCE(?, delivered_at_block_timestamp),
       released_tx_hash = COALESCE(?, released_tx_hash),
       disputed_tx_hash = COALESCE(?, disputed_tx_hash),
       dispute_filed_by = COALESCE(?, dispute_filed_by),
       resolved_tx_hash = COALESCE(?, resolved_tx_hash),
       amount_to_lawyer_wei = COALESCE(?, amount_to_lawyer_wei),
       amount_to_client_wei = COALESCE(?, amount_to_client_wei),
       refunded_tx_hash = COALESCE(?, refunded_tx_hash),
       updated_at = ?
     WHERE engagement_id = ? AND proposal_index = ?`,
  ).run(
    state,
    extra.funded_tx_hash ?? null,
    extra.delivered_tx_hash ?? null,
    extra.delivered_at_block_timestamp ?? null,
    extra.released_tx_hash ?? null,
    extra.disputed_tx_hash ?? null,
    extra.dispute_filed_by ?? null,
    extra.resolved_tx_hash ?? null,
    extra.amount_to_lawyer_wei ?? null,
    extra.amount_to_client_wei ?? null,
    extra.refunded_tx_hash ?? null,
    now,
    engagementId,
    proposalIndex,
  );
}
