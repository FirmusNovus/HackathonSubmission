// Owner spec: 001-verified-legal-engagement.

import { NextResponse } from 'next/server';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const lawyer = listVerifiedLawyerDirectory().find((l) => l.slug === ctx.params.slug);
  if (!lawyer) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ lawyer });
}
