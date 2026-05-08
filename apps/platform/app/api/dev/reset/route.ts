// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST() {
  if (!isBypassActive()) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const db = getDb();
  const tables = [
    'verified_users',
    'lawyer_profiles',
    'engagements_off_chain',
    'consultations',
    'proposals_off_chain',
    'messages',
    'mutual_refund_authorizations',
    'disputes_off_chain',
    'nonces',
    'verifier_states',
  ];
  const tx = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  });
  tx();
  return NextResponse.json({ ok: true });
}
