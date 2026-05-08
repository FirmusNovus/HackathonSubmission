// Owner spec: 001-verified-legal-engagement.
// Decline: PAID consultations create a mutual-refund authorization
// (lawyer-side signed) so the client can co-sign and broadcast to recover
// escrow. FREE consultations transition straight to DECLINED.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getConsultation, setStatus } from '@/lib/db/consultations';
import { getDb } from '@/lib/db/client';
import { keccak256, toBytes } from 'viem';

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
  setStatus(id, 'DECLINED');

  if (c.consultation_kind === 'PAID') {
    const nonce = keccak256(toBytes(`refund:${c.engagement_id}:0:${Date.now()}`));
    getDb()
      .prepare(
        `INSERT INTO mutual_refund_authorizations (engagement_id, proposal_index, nonce, lawyer_signature, created_at)
         VALUES (?, 0, ?, NULL, ?)`,
      )
      .run(c.engagement_id, nonce, Math.floor(Date.now() / 1000));
  }
  return NextResponse.json({ ok: true });
}
