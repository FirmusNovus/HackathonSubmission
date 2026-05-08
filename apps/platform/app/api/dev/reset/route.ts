// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST() {
  if (!isBypassActive()) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const db = getDb();
  // Delete in FK-safe order (children before parents). Disabling FKs for the
  // duration would also work, but explicit ordering documents the topology.
  const tables = [
    'messages',                       // → engagements_off_chain
    'mutual_refund_authorizations',   // → engagements_off_chain
    'disputes_off_chain',             // → engagements_off_chain
    'proposals_off_chain',            // → engagements_off_chain
    'consultations',                  // → engagements_off_chain
    'engagements_off_chain',          // root
    'lawyer_profiles',                // → verified_users (logical)
    'verified_users',                 // root
    'nonces',
    'verifier_states',
  ];
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare(`DELETE FROM sqlite_sequence`).run();
  });
  try {
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return NextResponse.json({ ok: true });
}
