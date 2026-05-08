// Owner spec: 001-verified-legal-engagement.
// Receives vp_token from the wallet, verifies SD-JWT VC, writes the EAS
// attestation if everything checks out.

import { NextRequest, NextResponse } from 'next/server';
import { pickVpFromToken } from '@firmus-novus/dcql';
import { SdJwtVerifyError, verifySdJwtVc } from '@firmus-novus/sd-jwt';
import { fetchIssuerJwks } from '@/lib/verifier/issuer-jwks';
import { clientId, getVerifierCert } from '@/lib/verifier/x509';
import { markRejected, markVerified, readState } from '@/lib/verifier/state';
import { operatorWalletClient, publicClient } from '@/lib/chain/client';
import { attestationManager } from '@/lib/chain/contracts';
import { upsertVerifiedUser } from '@/lib/db/verified-users';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { state: string } }) {
  const row = readState(params.state);
  if (!row) return NextResponse.json({ error: 'unknown state' }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'state already completed' }, { status: 409 });
  }

  const ct = req.headers.get('content-type') ?? '';
  let vpToken: string | undefined;
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    vpToken = form.get('vp_token')?.toString();
  } else {
    const body = (await req.json()) as { vp_token?: string };
    vpToken = body.vp_token;
  }
  if (!vpToken) {
    markRejected(row.state, 'missing vp_token');
    return NextResponse.json({ error: 'missing vp_token' }, { status: 400 });
  }

  const credentialId = row.kind === 'bar' ? 'lawyer-cred' : 'pid-cred';
  let envelope: string;
  try {
    envelope = pickVpFromToken(vpToken, credentialId);
  } catch (e) {
    markRejected(row.state, `vp_token shape: ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const cert = getVerifierCert();
  const audience = clientId(cert.hostname);
  const issuerJwks = await fetchIssuerJwks(row.kind);

  let verified;
  try {
    verified = await verifySdJwtVc({
      envelope,
      issuerJwks,
      expectedAudience: audience,
      expectedNonce: row.nonce,
    });
  } catch (e) {
    const reason = e instanceof SdJwtVerifyError ? e.reason : (e as Error).message;
    markRejected(row.state, reason);
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // Bind verified attributes to the SIWE-bound address.
  if (!row.bound_address) {
    markRejected(row.state, 'state has no bound address');
    return NextResponse.json({ error: 'state has no bound address' }, { status: 400 });
  }
  const subject = row.bound_address as `0x${string}`;
  const wallet = operatorWalletClient();
  const now = Math.floor(Date.now() / 1000);

  try {
    if (row.kind === 'pid') {
      const country =
        ((verified.disclosed.address as { country?: string } | undefined)?.country ?? '') || '';
      const ageOver18 =
        ((verified.disclosed.age_equal_or_over as { '18'?: boolean } | undefined)?.['18'] ??
          false) === true;
      if (!country || !ageOver18) {
        markRejected(row.state, 'PID missing country / age_equal_or_over.18');
        return NextResponse.json({ error: 'PID disclosure incomplete' }, { status: 400 });
      }
      const tx = await wallet.writeContract({
        ...attestationManager,
        functionName: 'attestVerifiedClient',
        args: [subject, country, true],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      const SCHEMA_CLIENT = (await publicClient.readContract({
        ...attestationManager,
        functionName: 'SCHEMA_CLIENT',
      })) as `0x${string}`;
      const uid = (await publicClient.readContract({
        ...attestationManager,
        functionName: 'getLatestAttestationUid',
        args: [subject, SCHEMA_CLIENT],
      })) as `0x${string}`;
      upsertVerifiedUser({
        eth_address: subject,
        attested_role: 'client',
        attested_at: now,
        attestation_uid: uid,
        disclosed_attrs: {
          country_of_residence: country,
          age_equal_or_over_18: ageOver18,
        },
        message_pubkey: null,
        revoked_at: null,
      });
    } else {
      // bar
      const givenName = String(verified.disclosed.given_name ?? '');
      const familyName = String(verified.disclosed.family_name ?? '');
      const jurisdiction = String(verified.disclosed.jurisdiction ?? '');
      const barAdmissionDate = String(verified.disclosed.bar_admission_date ?? '');
      const barAdmissionNumber = String(verified.disclosed.bar_admission_number ?? '');
      const validUntil = String(verified.disclosed.valid_until ?? '');
      if (!jurisdiction || !barAdmissionNumber || !barAdmissionDate) {
        markRejected(row.state, 'bar disclosure incomplete');
        return NextResponse.json({ error: 'bar disclosure incomplete' }, { status: 400 });
      }
      const admittedAt = Math.floor(Date.parse(barAdmissionDate + 'T00:00:00Z') / 1000);
      const validUntilUnix = Math.floor(Date.parse(validUntil + 'T00:00:00Z') / 1000);
      const tx = await wallet.writeContract({
        ...attestationManager,
        functionName: 'attestVerifiedLawyer',
        args: [subject, jurisdiction, barAdmissionNumber, BigInt(admittedAt), BigInt(validUntilUnix)],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      const SCHEMA_LAWYER = (await publicClient.readContract({
        ...attestationManager,
        functionName: 'SCHEMA_LAWYER',
      })) as `0x${string}`;
      const uid = (await publicClient.readContract({
        ...attestationManager,
        functionName: 'getLatestAttestationUid',
        args: [subject, SCHEMA_LAWYER],
      })) as `0x${string}`;
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
    }
    markVerified(row.state, { kind: row.kind, address: subject });
    return NextResponse.json({ ok: true });
  } catch (e) {
    markRejected(row.state, `attest failed: ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
