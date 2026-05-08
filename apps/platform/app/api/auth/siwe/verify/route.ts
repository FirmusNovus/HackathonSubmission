// Owner spec: 001-verified-legal-engagement.

import { NextRequest, NextResponse } from 'next/server';
import { verifySiwe } from '@/lib/siwe/verify';
import { createSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { message, signature } = (await req.json()) as { message: string; signature: string };
  const result = await verifySiwe(message, signature);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  await createSession(result.address);
  return NextResponse.json({ ok: true, address: result.address });
}
