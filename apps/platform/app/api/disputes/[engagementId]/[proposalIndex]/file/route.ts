// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { devWalletForAddress } from '@/lib/dev/persona-broadcast';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { escrow } from '@/lib/chain/contracts';
import { publicClient } from '@/lib/chain/client';
import { keccak256, toBytes } from 'viem';
import { syncFromChain } from '@/lib/chain/indexer';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: { engagementId: string; proposalIndex: string } }) {
  const session = await getSessionWithRoles();
  if (!session?.isClient) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isBypassActive()) return NextResponse.json({ error: 'wallet-broadcast-not-implemented' }, { status: 501 });

  const wallet = devWalletForAddress(session.address);
  const root = keccak256(toBytes(`dispute-root:${session.address}:${Date.now()}`));
  const tx = await wallet.writeContract({
    ...escrow,
    functionName: 'disputeProposal',
    args: [BigInt(ctx.params.engagementId), BigInt(ctx.params.proposalIndex), root],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  await syncFromChain();
  return NextResponse.json({ ok: true, txHash: tx });
}
