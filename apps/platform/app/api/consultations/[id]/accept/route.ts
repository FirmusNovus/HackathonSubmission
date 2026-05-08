// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getConsultation, setStatus } from '@/lib/db/consultations';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await getSessionWithRoles();
  if (!session?.isLawyer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const id = Number(ctx.params.id);
  const c = getConsultation(id);
  if (!c) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  if (c.lawyer_user_id !== session.address.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 404 });
  }
  if (c.status !== 'REQUESTED') {
    return NextResponse.json({ ok: false, error: 'invalid-status' }, { status: 409 });
  }
  setStatus(id, 'ACCEPTED');
  return NextResponse.json({ ok: true });
}
