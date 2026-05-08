// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { PERSONAS } from '@/lib/dev/persona-fixtures';
import { PersonaPicker } from './persona-picker';

export default function PersonasPage() {
  if (!isBypassActive()) notFound();
  const view = PERSONAS.map((p) => ({
    index: p.index,
    walletAddress: p.walletAddress,
    displayName: p.displayName,
    roles: p.roles,
  }));
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl text-navy-900">Dev personas</h1>
      <p className="mt-2 text-sm text-slate-500">
        Pick a persona to skip the OID4VP onboarding flow. The platform will
        write the EAS attestation from the operator key, seed the lawyer
        profile (if applicable), and set your session cookie.
      </p>
      <PersonaPicker personas={view} />
    </main>
  );
}
