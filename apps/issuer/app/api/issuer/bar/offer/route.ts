// Owner spec: 001-verified-legal-engagement.
// POST {personaId} → creates a pre-auth offer + returns wwWallet handoff URL.
// Bar credentials are roster-gated: only persona IDs that exist with
// credential_type='bar' can mint. The platform UI only exposes lawyer
// personas as bar mint targets.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createOffer } from '@firmus-novus/oid4vci';
import { getDb } from '@/lib/db/client';
import { findBarById } from '@/lib/persona-lookup';

export const runtime = 'nodejs';

const Body = z.object({ personaId: z.number().int().positive() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'missing personaId' }, { status: 400 });
  }

  const subject = findBarById(parsed.data.personaId);
  if (!subject) {
    return NextResponse.json(
      {
        error: 'not on bar roster',
        detail: 'No bar accreditation on file for this persona.',
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
  const wwwalletUrl = `https://demo.wwwallet.org/cb?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  const deepLink = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;

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
