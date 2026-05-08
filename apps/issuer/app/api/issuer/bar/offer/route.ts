// Owner spec: 001-verified-legal-engagement.
// Bar offer endpoint — gates on the wallet being on the bar roster (FR-008).

import { NextRequest, NextResponse } from 'next/server';
import { isAddress, type Address } from 'viem';
import { createOffer } from '@firmus-novus/oid4vci';
import { getDb } from '@/lib/db/client';
import { findBarByAddress } from '@/lib/persona-lookup';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { subjectAddress?: string };
  try {
    body = (await req.json()) as { subjectAddress?: string };
  } catch {
    body = {};
  }
  const subjectAddress = body.subjectAddress;
  if (!subjectAddress || !isAddress(subjectAddress)) {
    return NextResponse.json({ error: 'missing or invalid subjectAddress' }, { status: 400 });
  }

  const subject = findBarByAddress(subjectAddress as Address);
  if (!subject) {
    return NextResponse.json(
      {
        error: 'not on bar roster',
        detail: 'This wallet is not admitted to a bar association in our records.',
      },
      { status: 403 },
    );
  }

  const issuerHost = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  if (!issuerHost) {
    return NextResponse.json({ error: 'PUBLIC_HOSTNAME not set' }, { status: 500 });
  }

  const baseUrl = `${issuerHost}/api/issuer/bar`;
  const { offerId } = createOffer(getDb(), 'bar', subject.id);
  const offerUri = `${baseUrl}/credential-offer/${offerId}`;
  const deepLink = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  const wwwalletUrl = `https://demo.wwwallet.org/cb?credential_offer_uri=${encodeURIComponent(offerUri)}`;

  return NextResponse.json({
    offerId,
    offerUri,
    deepLink,
    wwwalletUrl,
    persona: {
      display_name: subject.display_name,
      jurisdiction: subject.jurisdiction,
      bar_admission_number: subject.bar_admission_number,
    },
  });
}
