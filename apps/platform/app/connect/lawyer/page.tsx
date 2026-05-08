// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LawyerOnboardingFlow } from './lawyer-flow';
import { isBypassActive } from '@/lib/dev/bypass-guard';

export const dynamic = 'force-dynamic';

export default function LawyerConnect({ searchParams }: { searchParams?: { returnTo?: string } }) {
  const returnTo = searchParams?.returnTo ?? '/verify-lawyer';
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-3xl text-navy-900">Verify professional status</h1>
      <p className="mt-2 text-sm text-slate-500">
        Three steps: authenticate with wallet, mint+present a PID credential, mint+present a
        bar accreditation. Both mints happen at the issuer; both presentations come back to
        the platform's verifier and write EAS attestations on chain.
      </p>

      <div className="mt-6">
        <LawyerOnboardingFlow returnTo={returnTo} />
      </div>

      {isBypassActive() ? (
        <div className="mt-8 rounded-lg border border-gold-500 bg-gold-100 p-4 text-sm text-gold-700">
          Dev bypass is active. Persona picker:{' '}
          <Link href="/dev/personas" className="underline">
            /dev/personas
          </Link>
          .
        </div>
      ) : null}

      <div className="mt-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/connect">Back</Link>
        </Button>
      </div>
    </main>
  );
}
