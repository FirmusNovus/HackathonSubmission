// Owner spec: 001-verified-legal-engagement.
// Receives vp_token from the wallet. Does ONLY SD-JWT verification + stores
// the disclosed attrs into the state row, then returns 200 fast (~hundreds
// of ms). The on-chain attestation is a separate step the platform fires
// after the wallet sees this 200 — otherwise wwWallet times out waiting
// for an EAS transaction to mine and shows "presentation process was not
// successful".

import { NextRequest, NextResponse } from 'next/server';
import { pickVpFromToken } from '@firmus-novus/dcql';
import { SdJwtVerifyError, verifySdJwtVc } from '@firmus-novus/sd-jwt';
import { fetchIssuerJwks } from '@/lib/verifier/issuer-jwks';
import { clientId, getVerifierCert } from '@/lib/verifier/x509';
import { markRejected, markVerified, readState } from '@/lib/verifier/state';

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

  try {
    const verified = await verifySdJwtVc({
      envelope,
      issuerJwks,
      expectedAudience: audience,
      expectedNonce: row.nonce,
    });
    markVerified(row.state, {
      kind: row.kind,
      disclosed: verified.disclosed,
      holderJwk: verified.holderJwk,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const reason = e instanceof SdJwtVerifyError ? e.reason : (e as Error).message;
    markRejected(row.state, reason);
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}
