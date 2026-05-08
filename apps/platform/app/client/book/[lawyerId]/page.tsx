// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { getLawyerProfile } from '@/lib/db/lawyer-profiles';
import { getVerifiedUser } from '@/lib/db/verified-users';
import { requireClient } from '@/lib/auth/require-role';
import { BookingForm } from './booking-form';

export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: { lawyerId: string } }) {
  const session = await requireClient();
  const profile = getLawyerProfile(params.lawyerId);
  const v = getVerifiedUser(params.lawyerId, 'lawyer');
  if (!profile || !v) notFound();

  const lawyerName =
    `${(v.disclosed_attrs.given_name as string) ?? ''} ${(v.disclosed_attrs.family_name as string) ?? ''}`.trim() ||
    profile.slug;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Request consultation</h1>
      <p className="mt-1 text-sm text-slate-500">
        With {lawyerName} · {profile.city} · {(v.disclosed_attrs.jurisdiction as string) ?? ''}
      </p>

      <BookingForm
        lawyerAddress={params.lawyerId}
        lawyerName={lawyerName}
        consultationKind={profile.consultation_type}
        rate30Wei={profile.consultation_rate_30_wei}
        rate60Wei={profile.consultation_rate_60_wei}
        clientAddress={session.address}
      />
    </main>
  );
}
