// Owner spec: 001-verified-legal-engagement.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionWithRoles } from '@/lib/auth/session';
import { operatorWalletClient, publicClient } from '@/lib/chain/client';
import { escrow } from '@/lib/chain/contracts';
import { syncFromChain } from '@/lib/chain/indexer';

export const runtime = 'nodejs';

const Body = z.object({ toLawyer: z.string(), toClient: z.string() });

export async function POST(req: NextRequest, ctx: { params: { engagementId: string; proposalIndex: string } }) {
  const session = await getSessionWithRoles();
  if (!session?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const wallet = operatorWalletClient();
  const tx = await wallet.writeContract({
    ...escrow,
    functionName: 'resolveDispute',
    args: [
      BigInt(ctx.params.engagementId),
      BigInt(ctx.params.proposalIndex),
      BigInt(parsed.data.toLawyer),
      BigInt(parsed.data.toClient),
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  await syncFromChain();
  return NextResponse.json({ ok: true, txHash: tx });
}
