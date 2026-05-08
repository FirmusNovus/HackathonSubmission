// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { requireLawyer } from '@/lib/auth/require-role';
import { getEngagement } from '@/lib/db/engagements';
import { ProposalForm } from './proposal-form';

export const dynamic = 'force-dynamic';

export default async function NewProposalPage({ params }: { params: { engagementId: string } }) {
  const session = await requireLawyer();
  const engagementId = Number(params.engagementId);
  const e = getEngagement(engagementId);
  if (!e || e.lawyer_address !== session.address.toLowerCase()) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl text-navy-900">Issue follow-up proposal</h1>
      <p className="mt-1 text-sm text-slate-500">
        For engagement #{engagementId}. Line items + deliverables are signed by your wallet
        and sent to the client to fund.
      </p>
      <ProposalForm engagementId={engagementId} />
    </main>
  );
}
