// Owner spec: 001-verified-legal-engagement.
// Bar credential endpoint — issues SD-JWT VC `urn:firmus-novus:LegalProfessionalAccreditation`.

import { NextRequest, NextResponse } from 'next/server';
import type { JWK } from 'jose';
import { readAccessToken, markIssued } from '@firmus-novus/oid4vci';
import { issueSdJwtVc } from '@firmus-novus/sd-jwt';
import { issuerBaseUrl, loadSigningKey } from '@/lib/keys';
import { findBarById } from '@/lib/persona-lookup';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = (req.headers.get('authorization') ?? '').replace(/^(Bearer|DPoP)\s+/i, '');
  const session = readAccessToken(getDb(), auth);
  if (!session || session.kind !== 'bar') {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const body = (await req.json()) as {
    proof?: { proof_type?: string; jwt?: string };
    proofs?: { jwt?: string[] | string };
  };

  let proofJwts: string[] = [];
  if (body.proofs?.jwt) {
    proofJwts = Array.isArray(body.proofs.jwt) ? body.proofs.jwt : [body.proofs.jwt];
  } else if (body.proof?.jwt) {
    proofJwts = [body.proof.jwt];
  } else {
    return NextResponse.json({ error: 'missing proof' }, { status: 400 });
  }

  const subject = findBarById(session.persona_id);
  if (!subject) {
    return NextResponse.json({ error: 'no bar attributes for subject' }, { status: 500 });
  }

  const signingKey = await loadSigningKey('bar');
  const issuerHttpsUrl = issuerBaseUrl('bar');
  const validUntilUnix = Math.floor(Date.parse(subject.valid_until + 'T00:00:00Z') / 1000);

  const credentials: string[] = [];
  for (const jwt of proofJwts) {
    let holderJwk: JWK | null = null;
    try {
      const headerB64 = jwt.split('.')[0];
      const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf-8'));
      if (header.jwk) holderJwk = header.jwk as JWK;
    } catch {}
    if (!holderJwk) {
      return NextResponse.json({ error: 'proof JWT missing inline jwk in header' }, { status: 400 });
    }
    const issued = await issueSdJwtVc({
      signingKey,
      vct: 'urn:firmus-novus:LegalProfessionalAccreditation',
      issuerHttpsUrl,
      holderCnfJwk: holderJwk,
      disclosableClaims: {
        given_name: subject.given_name,
        family_name: subject.family_name,
        jurisdiction: subject.jurisdiction,
        bar_admission_date: subject.bar_admission_date,
        bar_admission_number: subject.bar_admission_number,
        valid_until: subject.valid_until,
      },
      expiresAtUnix: validUntilUnix,
    });
    credentials.push(issued.envelope);
  }

  markIssued(getDb(), auth);
  return NextResponse.json(
    {
      format: 'vc+sd-jwt',
      credential: credentials[0],
      credentials: credentials.map((c) => ({ credential: c })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
