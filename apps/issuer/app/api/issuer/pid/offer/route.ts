// Owner spec: 001-verified-legal-engagement.
// POST {personaId} → creates a pre-auth offer + returns wwWallet handoff URL.
// The credential binds to the wallet's holder key (cnf.jwk) at the
// /credential exchange step; no Ethereum address is needed at offer time.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createOffer } from '@firmus-novus/oid4vci';
import { getDb } from '@/lib/db/client';
import { findPidById } from '@/lib/persona-lookup';

export const runtime = 'nodejs';

const Body = z.object({ personaId: z.number().int().positive() });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'missing personaId' }, { status: 400 });
  }
  const subject = findPidById(parsed.data.personaId);
  if (!subject) {
    return NextResponse.json({ error: 'unknown persona' }, { status: 404 });
  }

  const issuerHost = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  if (!issuerHost) {
    return NextResponse.json({ error: 'PUBLIC_HOSTNAME not set' }, { status: 500 });
  }

  const baseUrl = `${issuerHost}/api/issuer/pid`;
  const { offerId } = createOffer(getDb(), 'pid', subject.id);
  const offerUri = `${baseUrl}/credential-offer/${offerId}`;
  const wwwalletUrl = `https://demo.wwwallet.org/cb?credential_offer_uri=${encodeURIComponent(offerUri)}`;
  const deepLink = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(offerUri)}`;

  return NextResponse.json({
    offerId,
    offerUri,
    deepLink,
    wwwalletUrl,
    persona: { display_name: subject.display_name },
  });
}
