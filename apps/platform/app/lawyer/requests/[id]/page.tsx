// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { requireLawyer } from '@/lib/auth/require-role';
import { getConsultation } from '@/lib/db/consultations';
import { anonymousClientId } from '@/lib/anonymize/client-id';
import { formatETH } from '@/lib/format/eth';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { RequestActions } from './request-actions';

export const dynamic = 'force-dynamic';

export default async function RequestPage({ params }: { params: { id: string } }) {
  const session = await requireLawyer();
  const id = Number(params.id);
  const c = getConsultation(id);
  if (!c || c.lawyer_user_id !== session.address.toLowerCase()) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Consultation request</h1>
      <p className="mt-1 text-sm text-slate-500">
        From {anonymousClientId(c.client_id)} · {c.practice_area}
      </p>

      <Card className="mt-6 p-6">
        <CardTitle>Request details</CardTitle>
        <CardContent className="mt-3 space-y-2 p-0 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Scheduled</span>
            <span>{new Date(c.scheduled_at * 1000).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Duration</span>
            <span>{c.duration_minutes} min</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Type</span>
            <span>{c.consultation_kind}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Fee</span>
            <span>
              {c.consultation_kind === 'PAID' ? formatETH(c.consultation_fee_wei) : 'Free'}
            </span>
          </div>
          {c.consultation_kind === 'PAID' ? (
            <div className="flex justify-between">
              <span className="text-slate-500">Platform fee (5%)</span>
              <span>{formatETH(c.platform_fee_wei)}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-4 p-6">
        <CardTitle>Case description</CardTitle>
        <CardContent className="mt-3 p-0 text-sm whitespace-pre-wrap">
          {c.case_description}
        </CardContent>
      </Card>

      <RequestActions consultationId={c.id} status={c.status} />
    </main>
  );
}
