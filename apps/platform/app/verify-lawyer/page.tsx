// Owner spec: 001-verified-legal-engagement.
// Post-onboarding profile editor. Lands here from /connect/lawyer after the
// bar credential has been presented and the EAS attestation is on chain.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireLawyer } from '@/lib/auth/require-role';
import { getLawyerProfile } from '@/lib/db/lawyer-profiles';
import { Button } from '@/components/ui/button';
import { VerifyLawyerForm } from './verify-lawyer-form';

export const dynamic = 'force-dynamic';

export default async function VerifyLawyerPage() {
  const session = await requireLawyer();
  const profile = getLawyerProfile(session.address);
  if (!profile) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8">
        <span className="inline-block rounded-pill bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
          Verified · on chain
        </span>
        <h1 className="mt-3 font-display text-3xl text-navy-900">Complete your profile</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your bar accreditation has been written on chain. Fill out the public-facing
          fields below so clients can find you in the directory. Credential-derived
          fields (name, jurisdiction, admission number) are read-only.
        </p>
      </div>

      <VerifyLawyerForm profile={profile} />

      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span>You can edit these fields any time from your dashboard.</span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/lawyer/dashboard">Skip for now →</Link>
        </Button>
      </div>
    </main>
  );
}
