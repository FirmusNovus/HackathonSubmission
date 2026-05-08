// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LawyerCard } from '@/components/firmus/lawyer-card';
import { Chip } from '@/components/ui/chip';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';

export const dynamic = 'force-dynamic';

const SPECIALTIES = ['Family', 'Estate', 'Property', 'Employment', 'Immigration', 'Business', 'Tax', 'IP'];

interface SearchParams {
  specialty?: string;
  language?: string;
  pricing?: string;
}

export default function LawyersDirectory({ searchParams }: { searchParams: Promise<SearchParams> | SearchParams }) {
  // searchParams is a regular object in this Next.js version.
  const params = (searchParams as SearchParams) ?? {};
  const lawyers = listVerifiedLawyerDirectory();
  const filtered = lawyers.filter((l) => {
    if (params.specialty && !l.specialties.includes(params.specialty)) return false;
    if (params.language && !l.languages.includes(params.language)) return false;
    if (params.pricing === 'free' && l.consultation_type !== 'FREE') return false;
    if (params.pricing === 'paid' && l.consultation_type !== 'PAID') return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy-900">Verified counsel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every lawyer below holds a current `verified_lawyer` capability attestation.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>

      <section aria-label="Filters" className="mt-6 flex flex-wrap items-center gap-2 border-y border-slate-100 py-4">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Specialty</span>
        <Link href="/lawyers" prefetch={false}>
          <Chip active={!params.specialty}>All</Chip>
        </Link>
        {SPECIALTIES.map((s) => (
          <Link key={s} href={`/lawyers?specialty=${encodeURIComponent(s)}`} prefetch={false}>
            <Chip active={params.specialty === s}>{s}</Chip>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((l) => (
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
        {filtered.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm text-slate-500">No matching counsel. Try removing a filter.</p>
            <Button asChild variant="ghost" size="sm" className="mt-2">
              <Link href="/lawyers">Clear filters</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
