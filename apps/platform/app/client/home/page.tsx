// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { listForClient } from '@/lib/db/consultations';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';
import { LawyerCard } from '@/components/firmus/lawyer-card';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requireClient } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  'Family',
  'Estate',
  'Property',
  'Employment',
  'Immigration',
  'Business',
  'Tax',
  'IP',
];

export default async function ClientHome() {
  const session = await requireClient();
  const consultations = listForClient(session.address);
  const active = consultations.find((c) => c.status === 'ACCEPTED' || c.status === 'IN_PROGRESS');
  const lawyers = listVerifiedLawyerDirectory().slice(0, 6);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Welcome back.</h1>

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        {CATEGORIES.map((c) => (
          <Link key={c} href={`/lawyers?specialty=${encodeURIComponent(c)}`}>
            <Card className="p-4 transition-colors hover:bg-slate-50">{c}</Card>
          </Link>
        ))}
      </section>

      {active ? (
        <Card className="mt-8 border-teal-300 bg-teal-50/40 p-6">
          <CardTitle>Active consultation</CardTitle>
          <CardContent className="mt-2 p-0 text-sm">
            <div className="text-slate-700">
              {active.practice_area} · {active.duration_minutes} min
            </div>
            <Button asChild className="mt-3" size="sm">
              <Link href={`/client/consultation/${active.engagement_id}`}>Enter consultation</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-10">
        <h2 className="text-xl text-navy-900">Recommended counsel</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lawyers.map((l) => (
            <LawyerCard
              key={l.user_id}
              slug={l.slug}
              name={`${(l.disclosed_attrs.given_name as string) ?? ''} ${(l.disclosed_attrs.family_name as string) ?? ''}`.trim() || l.slug}
              city={l.city}
              primarySpecialty={l.specialties[0] ?? 'General'}
              avatarUrl={l.avatar_url}
              attestationUid={l.attestation_uid}
              walletAddress={l.eth_address}
              consultationKind={l.consultation_type}
              pricingHeadline={l.pricing_headline}
              tags={l.tags}
              rating={4.8}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl text-navy-900">Your consultations</h2>
        <div className="mt-3 space-y-2">
          {consultations.length === 0 ? (
            <p className="text-sm text-slate-500">No consultations yet.</p>
          ) : (
            consultations.map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <div className="font-medium text-navy-900">{c.practice_area}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(c.scheduled_at * 1000).toLocaleString()} · {c.duration_minutes} min · {c.status}
                  </div>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/client/consultation/${c.engagement_id}`}>Open</Link>
                </Button>
              </Card>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
