// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { readPublicJwk } from '@/lib/keys';

export const runtime = 'nodejs';

export async function GET() {
  const jwk = readPublicJwk('pid');
  return NextResponse.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'no-store' } });
}
