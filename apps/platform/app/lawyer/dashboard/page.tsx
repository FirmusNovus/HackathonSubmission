// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { requireLawyer } from '@/lib/auth/require-role';
import { listForLawyer, expireStale } from '@/lib/db/consultations';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { anonymousClientId } from '@/lib/anonymize/client-id';
import { formatETH } from '@/lib/format/eth';

export const dynamic = 'force-dynamic';

export default async function LawyerDashboard() {
  const session = await requireLawyer();
  expireStale();
  const all = listForLawyer(session.address);
  const pending = all.filter((c) => c.status === 'REQUESTED');
  const accepted = all.filter((c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS');
  const completed = all.filter((c) => c.status === 'COMPLETED');
  const totalEarned = completed.reduce((acc, c) => acc + BigInt(c.consultation_fee_wei), 0n);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Dashboard</h1>

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Pending requests" value={pending.length} />
        <StatCard label="Active consultations" value={accepted.length} />
        <StatCard label="Completed" value={completed.length} />
        <StatCard label="Earned" value={formatETH(totalEarned)} />
      </section>

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
        <h2 className="text-xl text-navy-900">Active consultations</h2>
        <div className="mt-3 space-y-2">
          {accepted.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-slate-500">No active consultations.</p>
            </Card>
          ) : (
            accepted.map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <div className="font-mono text-xs text-slate-500">{anonymousClientId(c.client_id)}</div>
                  <div className="font-medium text-navy-900">{c.practice_area}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(c.scheduled_at * 1000).toLocaleString()} · {c.duration_minutes} min
                  </div>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/lawyer/consultation/${c.engagement_id}`}>Open</Link>
                </Button>
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
