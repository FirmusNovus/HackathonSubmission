// Owner spec: 001-verified-legal-engagement.
// Calls anvil's evm_increaseTime + evm_mine to fast-forward the chain.

import { NextRequest, NextResponse } from 'next/server';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { z } from 'zod';
import { RPC_URL } from '@/lib/chain/client';

export const runtime = 'nodejs';

const Body = z.object({ seconds: z.number().int().positive() });

export async function POST(req: NextRequest) {
  if (!isBypassActive()) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  await rpc('evm_increaseTime', [parsed.data.seconds]);
  await rpc('evm_mine', []);
  return NextResponse.json({ ok: true, advanced: parsed.data.seconds });
}

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  return r.json();
}
