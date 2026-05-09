// Owner spec: 001-verified-legal-engagement.
// Lists the seeded personas (PID + bar combined) so the test issuer's UI can
// show a picker. No PII beyond display name; just enough to label cards.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

interface PersonaRow {
  id: number;
  display_name: string;
  credential_type: 'pid' | 'bar';
  jurisdiction: string | null;
}

export async function GET() {
  const rows = getDb()
    .prepare(
      `SELECT id, display_name, credential_type, jurisdiction FROM subjects ORDER BY display_name, credential_type`,
    )
    .all() as PersonaRow[];

  // Group rows by display_name so the UI shows one card per person with
  // the credential types they're entitled to.
  const byName = new Map<string, {
    name: string;
    pidId: number | null;
    barId: number | null;
    jurisdiction: string | null;
  }>();
  for (const r of rows) {
    const e = byName.get(r.display_name) ?? {
      name: r.display_name,
      pidId: null,
      barId: null,
      jurisdiction: null,
    };
    if (r.credential_type === 'pid') e.pidId = r.id;
    else {
      e.barId = r.id;
      e.jurisdiction = r.jurisdiction;
    }
    byName.set(r.display_name, e);
  }
  return NextResponse.json({ personas: Array.from(byName.values()) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
