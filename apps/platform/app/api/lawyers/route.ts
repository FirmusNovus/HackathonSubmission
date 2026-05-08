// Owner spec: 001-verified-legal-engagement.

import { NextRequest, NextResponse } from 'next/server';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const specialty = url.searchParams.get('specialty');
  const language = url.searchParams.get('language');
  const pricing = url.searchParams.get('pricing');

  let rows = listVerifiedLawyerDirectory();
  if (specialty) rows = rows.filter((r) => r.specialties.includes(specialty));
  if (language) rows = rows.filter((r) => r.languages.includes(language));
  if (pricing === 'free') rows = rows.filter((r) => r.consultation_type === 'FREE');
  if (pricing === 'paid') rows = rows.filter((r) => r.consultation_type === 'PAID');

  return NextResponse.json({
    lawyers: rows.map((l) => ({
      slug: l.slug,
      userId: l.user_id,
      walletAddress: l.eth_address,
      attestationUid: l.attestation_uid,
      city: l.city,
      headline: l.headline,
      specialties: l.specialties,
      languages: l.languages,
      jurisdictions: l.jurisdictions,
      consultationKind: l.consultation_type,
      pricingHeadline: l.pricing_headline,
      consultationRate30Wei: l.consultation_rate_30_wei,
      consultationRate60Wei: l.consultation_rate_60_wei,
    })),
  });
}
