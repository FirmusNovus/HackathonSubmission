// Owner spec: 001-verified-legal-engagement.
// PATCH the calling lawyer's profile. Re-checks on-chain hasCapability so a
// revoked lawyer cannot sneak edits through (FR-046).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getLawyerProfile, upsertLawyerProfile } from '@/lib/db/lawyer-profiles';
import { publicClient } from '@/lib/chain/client';
import { attestationManager } from '@/lib/chain/contracts';

export const runtime = 'nodejs';

const SPECIALTIES = ['Family', 'Estate', 'Property', 'Employment', 'Immigration', 'Business', 'Tax', 'IP'] as const;

const Body = z.object({
  city: z.string().min(1).max(100),
  headline: z.string().min(1).max(160),
  bio: z.string().min(40).max(2000),
  specialties: z.array(z.enum(SPECIALTIES)).min(1).max(8),
  languages: z.array(z.string().min(1).max(40)).min(1).max(12),
  jurisdictions: z.array(z.string().min(2).max(8)).min(1).max(8),
  years_experience: z.number().int().nonnegative().max(80),
  consultation_type: z.enum(['FREE', 'PAID']),
  pricing_kind: z.enum(['HOURLY', 'FIXED', 'SUBSCRIPTION', 'SUCCESS']).default('HOURLY'),
  pricing_headline: z.string().max(200).default(''),
  consultation_rate_30_wei: z.string().regex(/^\d+$/).default('0'),
  consultation_rate_60_wei: z.string().regex(/^\d+$/).default('0'),
  hourly_rate_wei: z.string().regex(/^\d+$/).default('0'),
  tags: z.array(z.string().min(1).max(30)).max(8).default([]),
  availability: z.record(z.string()).default({}),
});

export async function PATCH(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session?.isLawyer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Re-check the on-chain attestation (FR-046).
  const SCHEMA_LAWYER = (await publicClient.readContract({
    ...attestationManager,
    functionName: 'SCHEMA_LAWYER',
  })) as `0x${string}`;
  const hasCap = (await publicClient.readContract({
    ...attestationManager,
    functionName: 'hasCapability',
    args: [session.address as `0x${string}`, SCHEMA_LAWYER],
  })) as boolean;
  if (!hasCap) {
    return NextResponse.json({ error: 'capability revoked or absent' }, { status: 403 });
  }

  const existing = getLawyerProfile(session.address);
  if (!existing) {
    return NextResponse.json({ error: 'profile not found — onboard first' }, { status: 404 });
  }

  upsertLawyerProfile({
    ...existing,
    ...parsed.data,
    user_id: session.address,
    avatar_url: existing.avatar_url,
    avatar_uploaded_at: existing.avatar_uploaded_at,
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getSessionWithRoles();
  if (!session?.isLawyer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const profile = getLawyerProfile(session.address);
  if (!profile) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ profile });
}
