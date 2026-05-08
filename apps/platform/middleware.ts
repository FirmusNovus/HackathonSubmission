// Owner spec: 001-verified-legal-engagement.
// Role-gated routing: returns 404 (not 403) on role mismatch to avoid leaking
// path existence. In Next.js 14 we cannot read SQLite from middleware (Edge
// runtime); we only check session presence here. Role gating happens in the
// per-feature server-side `requireClient/Lawyer/Operator` helpers.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED = ['/client/', '/lawyer/', '/operator/', '/verify-lawyer'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const guarded = PROTECTED.some((p) => pathname.startsWith(p));
  if (!guarded) return NextResponse.next();
  const cookie = req.cookies.get('fn_session')?.value;
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/connect';
    url.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/client/:path*', '/lawyer/:path*', '/operator/:path*', '/verify-lawyer'],
};
