// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export interface DisputeRow {
  engagement_id: number;
  proposal_index: number;
  state: 'disputed' | 'resolved';
  filed_by: 'client' | 'lawyer';
  filed_at: number;
  delivered_at: number | null;
  resolved_at: number | null;
  amount_to_lawyer_wei: string | null;
  amount_to_client_wei: string | null;
  dispute_tx_hash: string;
  resolve_tx_hash: string | null;
}

export function upsertDispute(d: DisputeRow): void {
  getDb()
    .prepare(
      `INSERT INTO disputes_off_chain (engagement_id, proposal_index, state, filed_by, filed_at, delivered_at, resolved_at, amount_to_lawyer_wei, amount_to_client_wei, dispute_tx_hash, resolve_tx_hash)
       VALUES (@engagement_id, @proposal_index, @state, @filed_by, @filed_at, @delivered_at, @resolved_at, @amount_to_lawyer_wei, @amount_to_client_wei, @dispute_tx_hash, @resolve_tx_hash)
       ON CONFLICT(engagement_id, proposal_index) DO UPDATE SET
         state = excluded.state,
         resolved_at = COALESCE(excluded.resolved_at, disputes_off_chain.resolved_at),
         amount_to_lawyer_wei = COALESCE(excluded.amount_to_lawyer_wei, disputes_off_chain.amount_to_lawyer_wei),
         amount_to_client_wei = COALESCE(excluded.amount_to_client_wei, disputes_off_chain.amount_to_client_wei),
         resolve_tx_hash = COALESCE(excluded.resolve_tx_hash, disputes_off_chain.resolve_tx_hash)`,
    )
    .run(d);
}

export function listOpenDisputes(): DisputeRow[] {
  return getDb()
    .prepare(`SELECT * FROM disputes_off_chain WHERE state = 'disputed' ORDER BY filed_at ASC`)
    .all() as DisputeRow[];
}
