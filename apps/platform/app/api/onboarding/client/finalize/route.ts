// Owner spec: 001-verified-legal-engagement.
// After the verifier endpoint marks a state 'verified', the platform calls
// this to write the EAS attestation from the operator key and persist the
// verified_users row. Decoupled from the wallet's response POST so the
// wallet doesn't wait on an on-chain tx.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { readState, clearResult } from '@/lib/verifier/state';
import { operatorWalletClient, publicClient } from '@/lib/chain/client';
import { attestationManager } from '@/lib/chain/contracts';
import { upsertVerifiedUser, getVerifiedUser } from '@/lib/db/verified-users';

export const runtime = 'nodejs';

const Body = z.object({ state: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const row = readState(parsed.data.state);
  if (!row) return NextResponse.json({ error: 'unknown state' }, { status: 404 });
  if (row.kind !== 'pid') {
    return NextResponse.json({ error: 'wrong kind for client finalize' }, { status: 400 });
  }
  if (row.status !== 'verified') {
    return NextResponse.json({ error: 'not verified yet' }, { status: 409 });
  }
  const subject = (row.bound_address ?? '').toLowerCase();
  if (!subject || subject !== session.address.toLowerCase()) {
    return NextResponse.json({ error: 'state-session mismatch' }, { status: 403 });
  }

  // Idempotency: if a verified_users row already exists for this (address, role),
  // we're being called again for an already-finalized state. Return ok.
  if (getVerifiedUser(subject, 'client')) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (!row.result_json) {
    return NextResponse.json({ error: 'verifier result already consumed' }, { status: 409 });
  }

  const result = JSON.parse(row.result_json) as { disclosed: Record<string, unknown> };
  const country =
    ((result.disclosed.address as { country?: string } | undefined)?.country ?? '') || '';
  const ageOver18 =
    ((result.disclosed.age_equal_or_over as { '18'?: boolean } | undefined)?.['18'] ?? false) ===
    true;
  if (!country || !ageOver18) {
    return NextResponse.json({ error: 'PID disclosure incomplete' }, { status: 400 });
  }

  try {
    const wallet = operatorWalletClient();
    const tx = await wallet.writeContract({
      ...attestationManager,
      functionName: 'attestVerifiedClient',
      args: [subject as `0x${string}`, country, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const SCHEMA_CLIENT = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'SCHEMA_CLIENT',
    })) as `0x${string}`;
    const uid = (await publicClient.readContract({
      ...attestationManager,
      functionName: 'getLatestAttestationUid',
      args: [subject as `0x${string}`, SCHEMA_CLIENT],
    })) as `0x${string}`;
    const now = Math.floor(Date.now() / 1000);
    upsertVerifiedUser({
      eth_address: subject,
      attested_role: 'client',
      attested_at: now,
      attestation_uid: uid,
      disclosed_attrs: { country_of_residence: country, age_equal_or_over_18: ageOver18 },
      message_pubkey: null,
      revoked_at: null,
    });
    // Drop the cleartext disclosure from the verifier_states row now that
    // it's been consumed (the EAS attestation is the canonical record).
    clearResult(row.state);
    return NextResponse.json({ ok: true, txHash: tx });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
