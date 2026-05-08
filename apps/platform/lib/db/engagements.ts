// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export interface Engagement {
  engagement_id: number;
  client_address: string;
  lawyer_address: string;
  matter_description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  current_transcript_root: string;
  last_anchor_block: number | null;
  state: 'Active' | 'Closed';
  created_at: number;
  closed_at: number | null;
}

export function upsertEngagement(e: Engagement): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO engagements_off_chain (engagement_id, client_address, lawyer_address, matter_description, target_jurisdiction, target_practice_area, current_transcript_root, last_anchor_block, state, created_at, closed_at)
     VALUES (@engagement_id, @client_address, @lawyer_address, @matter_description, @target_jurisdiction, @target_practice_area, @current_transcript_root, @last_anchor_block, @state, @created_at, @closed_at)
     ON CONFLICT(engagement_id) DO UPDATE SET
       matter_description = excluded.matter_description,
       target_jurisdiction = excluded.target_jurisdiction,
       target_practice_area = excluded.target_practice_area,
       current_transcript_root = excluded.current_transcript_root,
       last_anchor_block = excluded.last_anchor_block,
       state = excluded.state,
       closed_at = excluded.closed_at`,
  ).run({
    ...e,
    client_address: e.client_address.toLowerCase(),
    lawyer_address: e.lawyer_address.toLowerCase(),
  });
}

export function getEngagement(id: number): Engagement | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM engagements_off_chain WHERE engagement_id = ?`).get(id) as Engagement | undefined;
  return row ?? null;
}
