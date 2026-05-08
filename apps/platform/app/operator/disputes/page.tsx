// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { requireOperator } from '@/lib/auth/require-role';
import { listOpenDisputes } from '@/lib/db/disputes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatETH } from '@/lib/format/eth';
import { getProposal } from '@/lib/db/proposals';

export const dynamic = 'force-dynamic';

export default async function DisputesQueue() {
  await requireOperator();
  const disputes = listOpenDisputes();
  const enriched = disputes.map((d) => ({
    ...d,
    proposal: getProposal(d.engagement_id, d.proposal_index),
  }));
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Active disputes</h1>
      <p className="mt-1 text-sm text-slate-500">
        Resolve with a split that sums to the parked amount; the contract enforces sum-equality.
      </p>
      <div className="mt-6 space-y-2">
        {enriched.length === 0 ? (
          <Card className="p-6 text-sm text-slate-500">No active disputes — the platform is healthy.</Card>
        ) : (
          enriched.map((d) => (
            <Card key={`${d.engagement_id}-${d.proposal_index}`} className="flex items-center justify-between p-4 text-sm">
              <div>
                <div className="font-medium text-navy-900">
                  Engagement #{d.engagement_id} · Proposal {d.proposal_index}
                </div>
                <div className="text-xs text-slate-500">
                  Parked {formatETH(d.proposal?.total_wei ?? '0')} · filed by {d.filed_by} · {new Date(d.filed_at * 1000).toLocaleString()}
                </div>
              </div>
              <Button asChild size="sm">
                <Link href={`/operator/disputes/${d.engagement_id}/${d.proposal_index}`}>Review</Link>
              </Button>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
