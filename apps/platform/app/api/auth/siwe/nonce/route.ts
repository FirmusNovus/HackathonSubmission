// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { generateNonce } from '@/lib/siwe/nonce';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ nonce: generateNonce() });
}
