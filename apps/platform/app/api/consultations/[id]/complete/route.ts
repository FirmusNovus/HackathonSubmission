// Owner spec: 001-verified-legal-engagement.
// Client-only "Mark Complete" action: broadcasts releaseProposal(engagementId, 0)
// for paid consultations. Free consultations transition straight to COMPLETED.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getConsultation, setStatus } from '@/lib/db/consultations';
import { devWalletForAddress } from '@/lib/dev/persona-broadcast';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { escrow } from '@/lib/chain/contracts';
import { publicClient } from '@/lib/chain/client';
import { syncFromChain } from '@/lib/chain/indexer';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await getSessionWithRoles();
  if (!session?.isClient) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const id = Number(ctx.params.id);
  const c = getConsultation(id);
  if (!c) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  if (c.client_id !== session.address.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 404 });
  }
  if (c.status === 'COMPLETED') return NextResponse.json({ ok: true, already: true });

  if (c.consultation_kind === 'PAID') {
    if (!isBypassActive()) {
      return NextResponse.json({ ok: false, error: 'wallet-broadcast-not-implemented' }, { status: 501 });
    }
    const wallet = devWalletForAddress(session.address);
    const tx = await wallet.writeContract({
      ...escrow,
      functionName: 'releaseProposal',
      args: [BigInt(c.engagement_id), 0n],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    setStatus(id, 'COMPLETED', { escrow_release_tx_hash: tx });
    await syncFromChain();
    return NextResponse.json({ ok: true, txHash: tx });
  }

  setStatus(id, 'COMPLETED');
  return NextResponse.json({ ok: true });
}
