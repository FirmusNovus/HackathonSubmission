// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { issuerBaseUrl } from '@/lib/keys';

export const runtime = 'nodejs';

export async function GET() {
  const baseUrl = issuerBaseUrl('bar');
  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      credential_endpoint: `${baseUrl}/credential`,
      token_endpoint: `${baseUrl}/token`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      credential_configurations_supported: {
        BarAccreditation_sdjwt: {
          format: 'vc+sd-jwt',
          vct: 'urn:firmus-novus:LegalProfessionalAccreditation',
          cryptographic_binding_methods_supported: ['jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
          display: [{ name: 'Bar Accreditation', locale: 'en-US' }],
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
