// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { issuerBaseUrl } from '@/lib/keys';

export const runtime = 'nodejs';

export async function GET() {
  const baseUrl = issuerBaseUrl('bar');
  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      authorization_servers: [baseUrl],
      credential_endpoint: `${baseUrl}/credential`,
      batch_credential_issuance: { batch_size: 5 },
      credential_configurations_supported: {
        BarAccreditation_sdjwt: {
          format: 'vc+sd-jwt',
          scope: 'BarAccreditation',
          cryptographic_binding_methods_supported: ['did:key', 'jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: { proof_signing_alg_values_supported: ['ES256'] },
          },
          vct: 'urn:firmus-novus:LegalProfessionalAccreditation',
          credential_metadata: {
            display: [
              {
                name: 'Legal Professional Accreditation',
                description:
                  'Bar association attestation that the holder is admitted to practise law.',
                locale: 'en-GB',
                background_color: '#1e3a8a',
                text_color: '#f5f5f5',
              },
            ],
            claims: [
              { path: ['given_name'], display: [{ name: 'First name', locale: 'en-GB' }] },
              { path: ['family_name'], display: [{ name: 'Family name', locale: 'en-GB' }] },
              { path: ['jurisdiction'], display: [{ name: 'Jurisdiction', locale: 'en-GB' }] },
              { path: ['bar_admission_date'], display: [{ name: 'Admitted to bar', locale: 'en-GB' }] },
              { path: ['bar_admission_number'], display: [{ name: 'Bar admission no.', locale: 'en-GB' }] },
              { path: ['valid_until'], display: [{ name: 'Valid until', locale: 'en-GB' }] },
            ],
          },
        },
      },
      display: [{ name: 'Test Bar Issuer', locale: 'en-GB' }],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
