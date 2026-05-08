// Owner spec: 001-verified-legal-engagement.
// Client funds an Issued proposal on chain. The contract verifies the
// lawyer's EIP-712 ProposalOffer signature; revert codes surface cleanly.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { getProposal, setProposalState } from '@/lib/db/proposals';
import { devWalletForAddress } from '@/lib/dev/persona-broadcast';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { escrow } from '@/lib/chain/contracts';
import { publicClient } from '@/lib/chain/client';
import { syncFromChain } from '@/lib/chain/indexer';
import { classifyRevert } from '@/lib/chain/broadcast';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: { engagementId: string; proposalIndex: string } },
) {
  const session = await getSessionWithRoles();
  if (!session?.isClient) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isBypassActive()) {
    return NextResponse.json({ error: 'wallet-broadcast-not-implemented' }, { status: 501 });
  }

  const engagementId = Number(ctx.params.engagementId);
  const proposalIndex = Number(ctx.params.proposalIndex);
  const e = getEngagement(engagementId);
  if (!e) return NextResponse.json({ error: 'engagement-not-found' }, { status: 404 });
  if (e.client_address !== session.address.toLowerCase()) {
    return NextResponse.json({ error: 'not-engagement-client' }, { status: 403 });
  }
  const proposal = getProposal(engagementId, proposalIndex);
  if (!proposal) return NextResponse.json({ error: 'proposal-not-found' }, { status: 404 });
  if (proposal.state !== 'Issued') {
    return NextResponse.json({ error: 'invalid-proposal-state' }, { status: 409 });
  }

  const wallet = devWalletForAddress(session.address);
  try {
    const tx = await wallet.writeContract({
      ...escrow,
      functionName: 'fundProposal',
      args: [
        BigInt(engagementId),
        BigInt(proposal.total_wei),
        proposal.items_hash as `0x${string}`,
        proposal.nonce as `0x${string}`,
        proposal.lawyer_offer_signature as `0x${string}`,
      ],
      value: BigInt(proposal.total_wei),
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    setProposalState(engagementId, proposalIndex, 'Funded', { funded_tx_hash: tx });
    await syncFromChain();
    return NextResponse.json({ ok: true, txHash: tx });
  } catch (err) {
    const r = classifyRevert(err);
    return NextResponse.json({ error: r.code, detail: r.detail }, { status: r.status });
  }
}
