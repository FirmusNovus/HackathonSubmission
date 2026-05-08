// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getConsultation } from '@/lib/db/consultations';
import { getEngagement } from '@/lib/db/engagements';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(ctx.params.id);
  const c = getConsultation(id);
  if (!c) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const isParty = c.client_id === session.address.toLowerCase() || c.lawyer_user_id === session.address.toLowerCase();
  if (!isParty) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const e = getEngagement(c.engagement_id);
  return NextResponse.json({ consultation: c, engagement: e });
}
