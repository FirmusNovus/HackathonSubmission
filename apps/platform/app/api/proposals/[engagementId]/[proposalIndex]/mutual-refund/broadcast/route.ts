// Owner spec: 001-verified-legal-engagement.
// Once both sigs are stored, either party can broadcast the on-chain refund.
// In dev-bypass mode, the platform broadcasts on behalf of the calling persona.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { getDb } from '@/lib/db/client';
import { devWalletForAddress } from '@/lib/dev/persona-broadcast';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { escrow } from '@/lib/chain/contracts';
import { publicClient } from '@/lib/chain/client';
import { syncFromChain } from '@/lib/chain/indexer';
import { classifyRevert } from '@/lib/chain/broadcast';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  ctx: { params: { engagementId: string; proposalIndex: string } },
) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isBypassActive()) {
    return NextResponse.json({ error: 'wallet-broadcast-not-implemented' }, { status: 501 });
  }
  const engagementId = Number(ctx.params.engagementId);
  const proposalIndex = Number(ctx.params.proposalIndex);
  const engagement = getEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const isParty = engagement.client_address === session.address.toLowerCase()
    || engagement.lawyer_address === session.address.toLowerCase();
  if (!isParty) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const auth = getDb()
    .prepare(
      `SELECT * FROM mutual_refund_authorizations WHERE engagement_id = ? AND proposal_index = ? AND broadcast_tx_hash IS NULL ORDER BY id DESC LIMIT 1`,
    )
    .get(engagementId, proposalIndex) as
    | { id: number; nonce: string; client_signature: string | null; lawyer_signature: string | null }
    | undefined;
  if (!auth) return NextResponse.json({ error: 'no-pending-auth' }, { status: 404 });
  if (!auth.client_signature || !auth.lawyer_signature) {
    return NextResponse.json({ error: 'missing-signature' }, { status: 409 });
  }

  const wallet = devWalletForAddress(session.address);
  try {
    const tx = await wallet.writeContract({
      ...escrow,
      functionName: 'mutualRefundProposal',
      args: [
        BigInt(engagementId),
        BigInt(proposalIndex),
        auth.nonce as `0x${string}`,
        auth.client_signature as `0x${string}`,
        auth.lawyer_signature as `0x${string}`,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    getDb()
      .prepare(`UPDATE mutual_refund_authorizations SET broadcast_tx_hash = ? WHERE id = ?`)
      .run(tx, auth.id);
    await syncFromChain();
    return NextResponse.json({ ok: true, txHash: tx });
  } catch (e) {
    const r = classifyRevert(e);
    return NextResponse.json({ error: r.code, detail: r.detail }, { status: r.status });
  }
}
