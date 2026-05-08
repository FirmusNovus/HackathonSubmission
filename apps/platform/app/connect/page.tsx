// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isBypassActive } from '@/lib/dev/bypass-guard';

export const dynamic = 'force-dynamic';

export default function ConnectPage({ searchParams }: { searchParams?: { returnTo?: string } }) {
  const bypass = isBypassActive();
  const returnTo = searchParams?.returnTo ?? '/';
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-navy-900">Connect to continue</h1>
      <p className="mt-2 text-sm text-slate-500">
        Sign in with your wallet to either book or offer counsel.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-navy-900">I&apos;m a client</h2>
          <p className="mt-1 text-sm text-slate-500">
            Present an EU resident credential. Disclose only country and 18+.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href={`/connect/client?returnTo=${encodeURIComponent(returnTo)}`}>Continue</Link>
          </Button>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-navy-900">I&apos;m a lawyer</h2>
          <p className="mt-1 text-sm text-slate-500">
            Present your bar accreditation. Cleartext name, jurisdiction, admission number.
          </p>
          <Button asChild variant="secondary" className="mt-4 w-full">
            <Link href={`/connect/lawyer?returnTo=${encodeURIComponent(returnTo)}`}>Continue</Link>
          </Button>
        </Card>
      </div>

      {bypass ? (
        <div className="mt-8 rounded-lg border border-gold-500 bg-gold-100 p-4 text-sm text-gold-700">
          <strong>Dev bypass active.</strong> Pick a pre-staged persona to skip OID4VP{' '}
          <Link className="underline" href="/dev/personas">
            here
          </Link>
          .
        </div>
      ) : null}
    </main>
  );
}
