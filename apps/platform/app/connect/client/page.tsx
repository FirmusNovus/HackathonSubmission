// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isBypassActive } from '@/lib/dev/bypass-guard';

export const dynamic = 'force-dynamic';

export default function ClientConnect({ searchParams }: { searchParams?: { returnTo?: string } }) {
  const bypass = isBypassActive();
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl text-navy-900">Verify identity</h1>
      <p className="mt-2 text-sm text-slate-500">
        Step 1: connect your wallet. Step 2: present a PID credential disclosing only
        country and age 18+.
      </p>

      <Card className="mt-8 space-y-4 p-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Step 1</div>
          <div className="text-base text-navy-900">Authenticate with wallet (SIWE)</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Step 2</div>
          <div className="text-base text-navy-900">Present PID credential (OID4VP)</div>
          <p className="mt-1 text-xs text-slate-500">
            Wallet handoff opens at <code>demo.wwwallet.org</code>. Only the country code
            and the 18+ flag are disclosed.
          </p>
        </div>
      </Card>

      {bypass ? (
        <Card className="mt-6 border-gold-500 bg-gold-100 p-6">
          <div className="text-sm text-gold-700">
            Dev bypass active. Pick a pre-staged client persona via{' '}
            <Link href="/dev/personas" className="underline">
              /dev/personas
            </Link>
            .
          </div>
        </Card>
      ) : null}

      <div className="mt-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/connect">Back</Link>
        </Button>
      </div>
    </main>
  );
}
