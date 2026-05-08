import { NextResponse, type NextRequest } from "next/server";

// `/onboarding/*` is intentionally NOT protected: SIWE happens *inside* the
// onboarding page, so blocking unauthenticated access to it would lock users
// out of the very flow that gets them authenticated.
const PROTECTED_PREFIXES = [
  "/client",
  "/lawyer",
  "/arbiter",
  "/operator",
];

const SESSION_COOKIE = "lex_nova_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("connect", "true");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/client/:path*", "/lawyer/:path*", "/arbiter/:path*", "/operator/:path*"],
};
