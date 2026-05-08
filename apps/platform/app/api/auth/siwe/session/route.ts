// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { getSessionWithRoles } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET() {
  const s = await getSessionWithRoles();
  if (!s) return NextResponse.json({ session: null });
  return NextResponse.json({
    session: {
      address: s.address,
      role: s.role,
      isClient: s.isClient,
      isLawyer: s.isLawyer,
      isOperator: s.isOperator,
    },
  });
}
