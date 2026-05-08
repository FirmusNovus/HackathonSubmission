// Owner spec: 001-verified-legal-engagement.
// FR-D06: idempotent persona seeding (writes EAS attestations, verified_users
// row, lawyer_profiles fixture, sets session cookie). 404 unless dev-bypass.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isBypassActive, assertBypassActive } from '@/lib/dev/bypass-guard';
import { getPersonaByIndex } from '@/lib/dev/persona-fixtures';
import { operatorWalletClient, publicClient } from '@/lib/chain/client';
import { attestationManager } from '@/lib/chain/contracts';
import { upsertVerifiedUser } from '@/lib/db/verified-users';
import { upsertLawyerProfile } from '@/lib/db/lawyer-profiles';
import { createSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

const Body = z.object({ persona: z.number().int().min(0).max(6) });

export async function POST(req: NextRequest) {
  if (!isBypassActive()) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  assertBypassActive();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const persona = getPersonaByIndex(parsed.data.persona);
  if (!persona) return NextResponse.json({ error: 'unknown-persona' }, { status: 400 });

  const wallet = operatorWalletClient();
  const now = Math.floor(Date.now() / 1000);

  if (persona.roles.includes('client') && persona.disclosed_attrs.client) {
    const da = persona.disclosed_attrs.client;
    const has = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'hasCapability',
      args: [persona.walletAddress, await publicClient.readContract({ ...attestationManager, functionName: 'SCHEMA_CLIENT' })],
    })) as boolean;
    if (!has) {
      const tx = await wallet.writeContract({
        ...attestationManager,
        functionName: 'attestVerifiedClient',
        args: [persona.walletAddress, da.country_of_residence, da.age_equal_or_over_18],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    }
    const uid = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'getLatestAttestationUid',
      args: [persona.walletAddress, await publicClient.readContract({ ...attestationManager, functionName: 'SCHEMA_CLIENT' })],
    })) as `0x${string}`;
    upsertVerifiedUser({
      eth_address: persona.walletAddress,
      attested_role: 'client',
      attested_at: now,
      attestation_uid: uid,
      disclosed_attrs: da,
      message_pubkey: null,
      revoked_at: null,
    });
  }

  if (persona.roles.includes('lawyer') && persona.disclosed_attrs.lawyer) {
    const da = persona.disclosed_attrs.lawyer;
    const SCHEMA_LAWYER = await publicClient.readContract({ ...attestationManager, functionName: 'SCHEMA_LAWYER' });
    const has = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'hasCapability',
      args: [persona.walletAddress, SCHEMA_LAWYER],
    })) as boolean;
    if (!has) {
      const admittedAt = Math.floor(new Date(da.bar_admission_date).getTime() / 1000);
      const validUntil = Math.floor(new Date(da.valid_until).getTime() / 1000);
      const tx = await wallet.writeContract({
        ...attestationManager,
        functionName: 'attestVerifiedLawyer',
        args: [
          persona.walletAddress,
          da.jurisdiction,
          da.bar_admission_number,
          BigInt(admittedAt),
          BigInt(validUntil),
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    }
    const uid = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'getLatestAttestationUid',
      args: [persona.walletAddress, SCHEMA_LAWYER],
    })) as `0x${string}`;
    upsertVerifiedUser({
      eth_address: persona.walletAddress,
      attested_role: 'lawyer',
      attested_at: now,
      attestation_uid: uid,
      disclosed_attrs: da,
      message_pubkey: null,
      revoked_at: null,
    });
    if (persona.lawyerProfile) {
      upsertLawyerProfile({
        user_id: persona.walletAddress,
        ...persona.lawyerProfile,
        avatar_url: null,
        avatar_uploaded_at: null,
      });
    }
  }

  await createSession(persona.walletAddress);
  return NextResponse.json({ ok: true, address: persona.walletAddress, displayName: persona.displayName });
}
