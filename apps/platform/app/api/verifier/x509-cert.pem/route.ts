// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { getVerifierCert } from '@/lib/verifier/x509';

export const runtime = 'nodejs';

export async function GET() {
  const { certPem } = getVerifierCert();
  return new NextResponse(certPem, {
    headers: { 'Content-Type': 'application/x-pem-file', 'Cache-Control': 'no-store' },
  });
}
