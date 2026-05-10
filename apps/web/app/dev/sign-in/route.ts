import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth/config";

// Dev/test-only sign-in helper. Returns 404 in production. Used by Playwright.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "missing wallet" }, { status: 400 });
  const role = url.searchParams.get("role") === "lawyer" ? "lawyer" : "client";
  const dest = url.searchParams.get("redirect") ?? (role === "lawyer" ? "/lawyer/dashboard" : "/client/home");
  // Auth.js's signIn throws NEXT_REDIRECT internally on success; let Next handle that.
  await signIn("dev-login", {
    walletAddress: wallet,
    role: role.toUpperCase(),
    redirectTo: dest,
  });
  return NextResponse.redirect(new URL(dest, url.origin));
}
