// Owner spec: 001-verified-legal-engagement.
// Stores + retrieves the public ECDH keys used for per-engagement messaging.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { setMessagePubkey, getVerifiedUser } from '@/lib/db/verified-users';

export const runtime = 'nodejs';

const PostBody = z.object({
  publicJwk: z.record(z.unknown()),
  role: z.enum(['client', 'lawyer']),
});

export async function POST(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  setMessagePubkey(session.address, parsed.data.role, JSON.stringify(parsed.data.publicJwk));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const engagementId = Number(url.searchParams.get('engagementId'));
  const e = getEngagement(engagementId);
  if (!e) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const isParty = e.client_address === session.address.toLowerCase() || e.lawyer_address === session.address.toLowerCase();
  if (!isParty) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const client = getVerifiedUser(e.client_address, 'client');
  const lawyer = getVerifiedUser(e.lawyer_address, 'lawyer');
  return NextResponse.json({
    clientAddress: e.client_address,
    lawyerAddress: e.lawyer_address,
    clientPublicJwk: client?.message_pubkey ? JSON.parse(client.message_pubkey) : null,
    lawyerPublicJwk: lawyer?.message_pubkey ? JSON.parse(lawyer.message_pubkey) : null,
  });
}
