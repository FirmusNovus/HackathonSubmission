// Edge-safe NextAuth instance. Avoids importing the full config (which pulls
// in Prisma and node:fs via the chain helpers) into the middleware bundle.
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/edge-config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/client/:path*", "/lawyer/:path*", "/admin/:path*"],
};
