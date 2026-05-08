// Owner spec: 001-verified-legal-engagement.
// Browser polls this for the verifier flow's outcome.

import { NextResponse } from 'next/server';
import { readState } from '@/lib/verifier/state';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { state: string } }) {
  const row = readState(params.state);
  if (!row) return NextResponse.json({ error: 'unknown state' }, { status: 404 });
  return NextResponse.json(
    {
      status: row.status,
      kind: row.kind,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
