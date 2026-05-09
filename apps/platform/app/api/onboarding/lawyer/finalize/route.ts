// Owner spec: 001-verified-legal-engagement.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { readState, clearResult } from '@/lib/verifier/state';
import { operatorWalletClient, publicClient } from '@/lib/chain/client';
import { attestationManager } from '@/lib/chain/contracts';
import { upsertVerifiedUser, getVerifiedUser } from '@/lib/db/verified-users';
import { upsertLawyerProfile, getLawyerProfile } from '@/lib/db/lawyer-profiles';
import { keccak256, toBytes } from 'viem';

export const runtime = 'nodejs';

const Body = z.object({ state: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const row = readState(parsed.data.state);
  if (!row) return NextResponse.json({ error: 'unknown state' }, { status: 404 });
  if (row.kind !== 'bar') {
    return NextResponse.json({ error: 'wrong kind for lawyer finalize' }, { status: 400 });
  }
  if (row.status !== 'verified') {
    return NextResponse.json({ error: 'not verified yet' }, { status: 409 });
  }
  const subject = (row.bound_address ?? '').toLowerCase();
  if (!subject || subject !== session.address.toLowerCase()) {
    return NextResponse.json({ error: 'state-session mismatch' }, { status: 403 });
  }

  // Idempotency.
  if (getVerifiedUser(subject, 'lawyer')) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (!row.result_json) {
    return NextResponse.json({ error: 'verifier result already consumed' }, { status: 409 });
  }

  const result = JSON.parse(row.result_json) as { disclosed: Record<string, unknown> };
  const givenName = String(result.disclosed.given_name ?? '');
  const familyName = String(result.disclosed.family_name ?? '');
  const jurisdiction = String(result.disclosed.jurisdiction ?? '');
  const barAdmissionDate = String(result.disclosed.bar_admission_date ?? '');
  const barAdmissionNumber = String(result.disclosed.bar_admission_number ?? '');
  const validUntil = String(result.disclosed.valid_until ?? '');
  if (!jurisdiction || !barAdmissionNumber || !barAdmissionDate) {
    return NextResponse.json({ error: 'bar disclosure incomplete' }, { status: 400 });
  }

  try {
    const admittedAt = Math.floor(Date.parse(barAdmissionDate + 'T00:00:00Z') / 1000);
    const validUntilUnix = Math.floor(Date.parse(validUntil + 'T00:00:00Z') / 1000);
    const wallet = operatorWalletClient();
    const tx = await wallet.writeContract({
      ...attestationManager,
      functionName: 'attestVerifiedLawyer',
      args: [
        subject as `0x${string}`,
        jurisdiction,
        barAdmissionNumber,
        BigInt(admittedAt),
        BigInt(validUntilUnix),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const SCHEMA_LAWYER = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'SCHEMA_LAWYER',
    })) as `0x${string}`;
    const uid = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'getLatestAttestationUid',
      args: [subject as `0x${string}`, SCHEMA_LAWYER],
    })) as `0x${string}`;
    const now = Math.floor(Date.now() / 1000);
    upsertVerifiedUser({
      eth_address: subject,
      attested_role: 'lawyer',
      attested_at: now,
      attestation_uid: uid,
      disclosed_attrs: {
        given_name: givenName,
        family_name: familyName,
        jurisdiction,
        bar_admission_date: barAdmissionDate,
        bar_admission_number: barAdmissionNumber,
        valid_until: validUntil,
      },
      message_pubkey: null,
      revoked_at: null,
    });

    // Auto-seed a default lawyer_profiles row so the lawyer appears in the
    // public directory immediately after onboarding. They edit it via
    // /verify-lawyer right after this call. Skip if a profile already
    // exists (re-attestation case).
    if (!getLawyerProfile(subject)) {
      const baseSlug = `${givenName}-${familyName}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const slugSuffix = keccak256(toBytes(subject)).slice(2, 6);
      const slug = baseSlug ? `${baseSlug}-${slugSuffix}` : `lawyer-${slugSuffix}`;
      upsertLawyerProfile({
        user_id: subject,
        slug,
        city: '',
        headline: `Verified counsel admitted in ${jurisdiction}.`,
        bio: `Newly verified lawyer. Profile setup in progress \u2014 the lawyer will fill in their bio, specialties, languages, and rates from /verify-lawyer.`,
        specialties: [],
        languages: [],
        jurisdictions: [jurisdiction],
        years_experience: 0,
        consultation_type: 'PAID',
        hourly_rate_wei: '0',
        pricing_kind: 'HOURLY',
        pricing_headline: '',
        consultation_rate_30_wei: '0',
        consultation_rate_60_wei: '0',
        pricing_items: [],
        tags: [],
        availability: {},
        avatar_url: null,
        avatar_uploaded_at: null,
      });
    }

    clearResult(row.state);
    return NextResponse.json({ ok: true, txHash: tx });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
