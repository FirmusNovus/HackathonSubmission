// Owner spec: 001-verified-legal-engagement.
// POST {subjectAddress} → creates a pre-auth offer + returns wwwallet handoff URL.

import { NextRequest, NextResponse } from 'next/server';
import { isAddress, type Address } from 'viem';
import { createOffer } from '@firmus-novus/oid4vci';
import { getDb } from '@/lib/db/client';
import { findPidByAddress } from '@/lib/persona-lookup';

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
  const subject = findPidByAddress(subjectAddress as Address);
  if (!subject) {
    return NextResponse.json(
      {
        error: 'no PID profile for this address',
        detail: 'This wallet is not on the PID provider roster. Use a seeded persona.',
      },
      { status: 400 },
    );
  }

  const issuerHost = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  if (!issuerHost) {
    return NextResponse.json({ error: 'PUBLIC_HOSTNAME not set' }, { status: 500 });
  }

  const baseUrl = `${issuerHost}/api/issuer/pid`;
  const { offerId } = createOffer(getDb(), 'pid', subject.id);
  const offerUri = `${baseUrl}/credential-offer/${offerId}`;
  const deepLink = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  const wwwalletUrl = `https://demo.wwwallet.org/cb?credential_offer_uri=${encodeURIComponent(offerUri)}`;

  return NextResponse.json({
    offerId,
    offerUri,
    deepLink,
    wwwalletUrl,
    persona: { display_name: subject.display_name },
  });
}
