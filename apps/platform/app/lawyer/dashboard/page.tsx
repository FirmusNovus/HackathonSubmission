// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireLawyer } from '@/lib/auth/require-role';
import { listForLawyer, expireStale } from '@/lib/db/consultations';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { anonymousClientId } from '@/lib/anonymize/client-id';
import { formatETH } from '@/lib/format/eth';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

interface DisputeRow {
  engagement_id: number;
  proposal_index: number;
  filed_by: 'client' | 'lawyer';
  filed_at: number;
}

export default async function LawyerDashboard() {
  const session = await requireLawyer();
  expireStale();
  const all = listForLawyer(session.address);
  const pending = all.filter((c) => c.status === 'REQUESTED');
  const accepted = all.filter((c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS');
  const completed = all.filter((c) => c.status === 'COMPLETED');
  const disputed = all.filter((c) => c.status === 'DISPUTED');
  const totalEarned = completed.reduce((acc, c) => acc + BigInt(c.consultation_fee_wei), 0n);

  // All Active engagements where this lawyer is a party — distinct from
  // pending/active consultations because a single engagement can carry
  // many proposals after the consultation closes.
  const activeEngagements = getDb()
    .prepare(
      `SELECT e.engagement_id, e.target_practice_area, e.client_address,
              (SELECT COUNT(*) FROM proposals_off_chain p
                 WHERE p.engagement_id = e.engagement_id
                   AND p.state IN ('Issued','Funded','Delivered','Disputed')) AS open_proposals
         FROM engagements_off_chain e
         WHERE e.lawyer_address = ? AND e.state = 'Active'
         ORDER BY e.engagement_id DESC
         LIMIT 8`,
    )
    .all(session.address.toLowerCase()) as Array<{
      engagement_id: number;
      target_practice_area: string;
      client_address: string;
      open_proposals: number;
    }>;

  // Open disputes where this lawyer is a party.
  const myDisputes = getDb()
    .prepare(
      `SELECT d.engagement_id, d.proposal_index, d.filed_by, d.filed_at
         FROM disputes_off_chain d
         JOIN engagements_off_chain e ON e.engagement_id = d.engagement_id
         WHERE d.state = 'disputed' AND e.lawyer_address = ?
         ORDER BY d.filed_at DESC`,
    )
    .all(session.address.toLowerCase()) as DisputeRow[];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Dashboard</h1>

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Pending requests" value={pending.length} />
        <StatCard label="Active consultations" value={accepted.length} />
        <StatCard label="Completed" value={completed.length} />
        <StatCard label="Earned" value={formatETH(totalEarned)} />
      </section>

      {myDisputes.length > 0 ? (
        <section className="mt-6">
          <Card className="border-amber-500 bg-amber-50/50 p-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
              <div className="flex-1">
                <CardTitle>Active disputes — {myDisputes.length}</CardTitle>
                <p className="mt-1 text-sm text-slate-700">
                  The platform operator reviews these. You can post additional ciphertext
                  evidence into the chat; the operator's resolution splits the parked
                  amount on chain.
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {myDisputes.map((d) => (
                <li key={`${d.engagement_id}-${d.proposal_index}`} className="flex justify-between">
                  <span>
                    Engagement #{d.engagement_id} · Proposal {d.proposal_index} · filed by {d.filed_by}
                  </span>
                  <Link href={`/lawyer/consultation/${d.engagement_id}`} className="text-teal-700 hover:underline">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-xl text-navy-900">Recent requests</h2>
        <div className="mt-3 space-y-2">
          {pending.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-slate-500">No pending requests.</p>
            </Card>
          ) : (
            pending.slice(0, 5).map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <div className="font-mono text-xs text-slate-500">{anonymousClientId(c.client_id)}</div>
                  <div className="font-medium text-navy-900">{c.practice_area}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(c.scheduled_at * 1000).toLocaleString()} · {c.duration_minutes} min ·{' '}
                    {c.consultation_kind === 'PAID' ? formatETH(c.consultation_fee_wei) : 'Free'}
                  </div>
                </div>
                <Button asChild size="sm">
                  <Link href={`/lawyer/requests/${c.id}`}>Review</Link>
                </Button>
              </Card>
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl text-navy-900">Active engagements</h2>
        <div className="mt-3 space-y-2">
          {activeEngagements.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-slate-500">No active engagements yet.</p>
            </Card>
          ) : (
            activeEngagements.map((e) => (
              <Card key={e.engagement_id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <div className="font-mono text-xs text-slate-500">{anonymousClientId(e.client_address)}</div>
                  <div className="font-medium text-navy-900">
                    Engagement #{e.engagement_id} · {e.target_practice_area || 'general'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.open_proposals} open proposal{e.open_proposals === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/lawyer/consultation/${e.engagement_id}`}>Open</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/lawyer/proposals/${e.engagement_id}/new`}>New proposal</Link>
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-navy-900">{value}</div>
    </Card>
  );
}
