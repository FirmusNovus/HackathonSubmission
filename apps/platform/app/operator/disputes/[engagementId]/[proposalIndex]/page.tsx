// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth/require-role';
import { getProposal } from '@/lib/db/proposals';
import { getEngagement } from '@/lib/db/engagements';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { formatETH } from '@/lib/format/eth';
import { ResolveForm } from './resolve-form';

export const dynamic = 'force-dynamic';

export default async function DisputeDetail({ params }: { params: { engagementId: string; proposalIndex: string } }) {
  await requireOperator();
  const engagementId = Number(params.engagementId);
  const proposalIndex = Number(params.proposalIndex);
  const proposal = getProposal(engagementId, proposalIndex);
  const engagement = getEngagement(engagementId);
  if (!proposal || !engagement) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Resolve dispute</h1>
      <p className="mt-1 text-sm text-slate-500">
        Engagement #{engagementId} · Proposal {proposalIndex}
      </p>

      <Card className="mt-6 p-6">
        <CardTitle>Parked amount</CardTitle>
        <CardContent className="mt-2 p-0 text-sm">
          <div>{formatETH(proposal.total_wei)}</div>
        </CardContent>
      </Card>

      <Card className="mt-4 p-6">
        <CardTitle>Evidence</CardTitle>
        <CardContent className="mt-2 p-0 text-sm">
          <p>
            Transcript root anchored at: <span className="font-mono text-xs">{engagement.current_transcript_root || '—'}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            The on-chain Merkle root is the authoritative tamper-evidence anchor. Off-chain
            ciphertext can be requested from the parties for review.
          </p>
        </CardContent>
      </Card>

      <ResolveForm
        engagementId={engagementId}
        proposalIndex={proposalIndex}
        totalWei={proposal.total_wei}
      />
    </main>
  );
}
