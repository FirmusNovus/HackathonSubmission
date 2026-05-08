// Owner spec: 001-verified-legal-engagement.
// Engagement detail used by the consultation room: returns the consultation
// row, all proposals (with state), and a couple of timing fields.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { getConsultationByEngagementId } from '@/lib/db/consultations';
import { listProposalsForEngagement } from '@/lib/db/proposals';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: { engagementId: string } }) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(ctx.params.engagementId);
  const e = getEngagement(id);
  if (!e) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const isParty = e.client_address === session.address.toLowerCase()
    || e.lawyer_address === session.address.toLowerCase();
  if (!isParty) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const consultation = getConsultationByEngagementId(id);
  const proposals = listProposalsForEngagement(id);

  // Sanitize: never leak the lawyer's offer signature to the client side
  // (it's already on chain when funded; pre-fund the client doesn't need it
  // to display the offer terms).
  return NextResponse.json({
    engagement: e,
    consultation,
    proposals: proposals.map((p) => ({
      ...p,
      lawyer_offer_signature: p.state === 'Issued' ? p.lawyer_offer_signature : '<consumed>',
    })),
  });
}
