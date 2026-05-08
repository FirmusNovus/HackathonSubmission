// Owner spec: 001-verified-legal-engagement.
// Client cancels a REQUESTED consultation (FR-015b).
// FREE: status -> CANCELLED, no on-chain action.
// PAID: status -> CANCELLED + insert mutual_refund_authorizations row
//       (the lawyer co-signs and either party broadcasts mutualRefundProposal).

import { NextResponse } from 'next/server';
import { keccak256, toBytes } from 'viem';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getConsultation, setStatus } from '@/lib/db/consultations';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await getSessionWithRoles();
  if (!session?.isClient) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const id = Number(ctx.params.id);
  const c = getConsultation(id);
  if (!c) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  if (c.client_id !== session.address.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 404 });
  }
  if (c.status !== 'REQUESTED') {
    return NextResponse.json({ ok: false, error: 'invalid-status' }, { status: 409 });
  }

  const now = Math.floor(Date.now() / 1000);
  setStatus(id, 'CANCELLED', { cancelled_by_client_at: now });

  if (c.consultation_kind === 'PAID') {
    const nonce = keccak256(toBytes(`refund:${c.engagement_id}:0:cancel:${now}`));
    getDb()
      .prepare(
        `INSERT INTO mutual_refund_authorizations (engagement_id, proposal_index, nonce, client_signature, created_at)
         VALUES (?, 0, ?, NULL, ?)`,
      )
      .run(c.engagement_id, nonce, now);
    return NextResponse.json({ ok: true, refundFlow: 'mutual', nonce });
  }
  return NextResponse.json({ ok: true });
}
