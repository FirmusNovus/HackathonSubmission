// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export type ConsultationStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPUTED';

export interface Consultation {
  id: number;
  engagement_id: number;
  client_id: string;
  lawyer_user_id: string;
  scheduled_at: number;
  duration_minutes: 30 | 60;
  practice_area: string;
  case_description: string;
  consultation_kind: 'FREE' | 'PAID';
  consultation_fee_wei: string;
  platform_fee_wei: string;
  status: ConsultationStatus;
  escrow_funding_tx_hash: string | null;
  escrow_release_tx_hash: string | null;
  expires_at: number;
  cancelled_by_client_at: number | null;
  created_at: number;
  updated_at: number;
}

export const REQUEST_TTL_SECONDS = 7 * 24 * 60 * 60;

export function insertConsultation(
  c: Omit<Consultation, 'id' | 'created_at' | 'updated_at' | 'expires_at' | 'cancelled_by_client_at'>,
): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + REQUEST_TTL_SECONDS;
  const r = db
    .prepare(
      `INSERT INTO consultations (engagement_id, client_id, lawyer_user_id, scheduled_at, duration_minutes, practice_area, case_description, consultation_kind, consultation_fee_wei, platform_fee_wei, status, escrow_funding_tx_hash, escrow_release_tx_hash, expires_at, cancelled_by_client_at, created_at, updated_at)
       VALUES (@engagement_id, @client_id, @lawyer_user_id, @scheduled_at, @duration_minutes, @practice_area, @case_description, @consultation_kind, @consultation_fee_wei, @platform_fee_wei, @status, @escrow_funding_tx_hash, @escrow_release_tx_hash, @expires_at, @cancelled_by_client_at, @created_at, @updated_at)`,
    )
    .run({
      ...c,
      client_id: c.client_id.toLowerCase(),
      lawyer_user_id: c.lawyer_user_id.toLowerCase(),
      expires_at: expires,
      cancelled_by_client_at: null,
      created_at: now,
      updated_at: now,
    });
  return Number(r.lastInsertRowid);
}

export function setStatus(id: number, status: ConsultationStatus, extra: Partial<Consultation> = {}): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE consultations SET status = ?, updated_at = ?, escrow_funding_tx_hash = COALESCE(?, escrow_funding_tx_hash), escrow_release_tx_hash = COALESCE(?, escrow_release_tx_hash), cancelled_by_client_at = COALESCE(?, cancelled_by_client_at) WHERE id = ?`,
  ).run(
    status,
    now,
    extra.escrow_funding_tx_hash ?? null,
    extra.escrow_release_tx_hash ?? null,
    extra.cancelled_by_client_at ?? null,
    id,
  );
}

export function getConsultation(id: number): Consultation | null {
  return (getDb().prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as Consultation | undefined) ?? null;
}

export function getConsultationByEngagementId(engagementId: number): Consultation | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM consultations WHERE engagement_id = ?`)
      .get(engagementId) as Consultation | undefined) ?? null
  );
}

export function listForLawyer(lawyer: string, status?: ConsultationStatus): Consultation[] {
  const db = getDb();
  if (status) {
    return db
      .prepare(`SELECT * FROM consultations WHERE lawyer_user_id = ? AND status = ? ORDER BY created_at DESC`)
      .all(lawyer.toLowerCase(), status) as Consultation[];
  }
  return db
    .prepare(`SELECT * FROM consultations WHERE lawyer_user_id = ? ORDER BY created_at DESC`)
    .all(lawyer.toLowerCase()) as Consultation[];
}

export function listForClient(client: string): Consultation[] {
  return getDb()
    .prepare(`SELECT * FROM consultations WHERE client_id = ? ORDER BY created_at DESC`)
    .all(client.toLowerCase()) as Consultation[];
}

export function expireStale(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const r = db
    .prepare(`UPDATE consultations SET status = 'EXPIRED', updated_at = ? WHERE status = 'REQUESTED' AND expires_at < ?`)
    .run(now, now);
  return r.changes;
}
