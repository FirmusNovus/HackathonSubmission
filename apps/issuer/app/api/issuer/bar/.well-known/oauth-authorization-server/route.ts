// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { issuerBaseUrl } from '@/lib/keys';

export const runtime = 'nodejs';

export async function GET() {
  const baseUrl = issuerBaseUrl('bar');
  return NextResponse.json(
    {
      issuer: baseUrl,
      token_endpoint: `${baseUrl}/token`,
      grant_types_supported: ['urn:ietf:params:oauth:grant-type:pre-authorized_code'],
      'pre-authorized_grant_anonymous_access_supported': true,
      dpop_signing_alg_values_supported: ['ES256'],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
