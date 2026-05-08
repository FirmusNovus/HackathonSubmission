// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ClientOnboardingFlow } from './client-flow';
import { isBypassActive } from '@/lib/dev/bypass-guard';

export const dynamic = 'force-dynamic';

export default function ClientConnect({ searchParams }: { searchParams?: { returnTo?: string } }) {
  const returnTo = searchParams?.returnTo ?? '/client/home';
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-3xl text-navy-900">Verify identity</h1>
      <p className="mt-2 text-sm text-slate-500">
        Sign in with your wallet, mint an EU PID credential at the issuer, and present
        only <code>address.country</code> and <code>age_equal_or_over.18</code> to the
        platform's verifier.
      </p>

      <div className="mt-6">
        <ClientOnboardingFlow returnTo={returnTo} />
      </div>

      {isBypassActive() ? (
        <div className="mt-8 rounded-lg border border-gold-500 bg-gold-100 p-4 text-sm text-gold-700">
          Dev bypass active. Persona picker:{' '}
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
