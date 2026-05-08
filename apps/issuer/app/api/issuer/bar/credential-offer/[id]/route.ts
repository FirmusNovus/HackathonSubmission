// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { readOfferById } from '@firmus-novus/oid4vci';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = readOfferById(getDb(), params.id);
  if (!row) return NextResponse.json({ error: 'offer_not_found' }, { status: 404 });
  const issuerHost = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, '');
  const baseUrl = `${issuerHost}/api/issuer/bar`;
  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      credential_configuration_ids: ['BarAccreditation_sdjwt'],
      grants: {
        'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
          'pre-authorized_code': row.pre_auth_code,
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
