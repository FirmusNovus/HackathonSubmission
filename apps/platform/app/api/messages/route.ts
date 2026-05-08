// Owner spec: 001-verified-legal-engagement.
// Server NEVER decrypts. Stores ciphertext, IV, salt, signature only.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { insertMessage, listMessages } from '@/lib/db/messages';
import { keccak256, toBytes } from 'viem';

export const runtime = 'nodejs';

const PostBody = z.object({
  engagementId: z.number().int().nonnegative(),
  ciphertextB64: z.string(),
  ivB64: z.string(),
  saltB64: z.string(),
  signature: z.string(),
});

function b64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function isParticipant(engagementId: number, address: string): boolean {
  const e = getEngagement(engagementId);
  if (!e) return false;
  const a = address.toLowerCase();
  return e.client_address === a || e.lawyer_address === a;
}

export async function POST(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  if (raw && typeof raw === 'object' && 'plaintext' in raw) {
    return NextResponse.json({ error: 'plaintext-not-allowed' }, { status: 400 });
  }

  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  if (!isParticipant(parsed.data.engagementId, session.address)) {
    return NextResponse.json({ error: 'not-participant' }, { status: 403 });
  }

  const ciphertext = b64ToBytes(parsed.data.ciphertextB64);
  const iv = b64ToBytes(parsed.data.ivB64);
  const salt = b64ToBytes(parsed.data.saltB64);
  const leafHash = keccak256(
    toBytes(`${parsed.data.ciphertextB64}|${parsed.data.signature}|${session.address}|${parsed.data.engagementId}`),
  );

  const row = insertMessage({
    engagement_id: parsed.data.engagementId,
    sender_address: session.address,
    ciphertext,
    iv,
    salt,
    signature: parsed.data.signature,
    transcript_leaf_hash: leafHash,
  });
  return NextResponse.json({ ok: true, message: { ...row, ciphertext: parsed.data.ciphertextB64 } });
}

export async function GET(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const engagementId = Number(url.searchParams.get('engagementId'));
  const sinceId = Number(url.searchParams.get('sinceId') ?? 0);
  if (!Number.isFinite(engagementId)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  if (!isParticipant(engagementId, session.address)) {
    return NextResponse.json({ error: 'not-participant' }, { status: 403 });
  }
  const rows = listMessages(engagementId, sinceId).map((m) => ({
    id: m.id,
    sender: m.sender_address,
    ciphertextB64: Buffer.from(m.ciphertext).toString('base64'),
    ivB64: Buffer.from(m.iv).toString('base64'),
    saltB64: Buffer.from(m.salt).toString('base64'),
    signature: m.signature,
    createdAt: m.created_at,
    transcriptLeafIndex: m.transcript_leaf_index,
  }));
  return NextResponse.json({ messages: rows });
}
