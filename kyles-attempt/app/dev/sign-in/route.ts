import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { attestVerifiedClient, hasCapability, OPERATOR_ADDRESS } from "@/lib/chain/escrow";
import { SCHEMA_CLIENT } from "@/lib/chain/schemas";

// Dev/test-only sign-in helper. Returns 404 in production. Used by Playwright.
//
// F2 addition: when signing in as a client we ensure they have an active
// SCHEMA_CLIENT capability — this stands in for the real EBSI Over18 VC
// presentation that F10 will wire up. Without it, `requireClient()` would
// bounce them back to /connect, breaking the dev/demo flow.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "missing wallet" }, { status: 400 });
  const role = url.searchParams.get("role") === "lawyer" ? "lawyer" : "client";
  const ebsiWalletProvider = url.searchParams.get("ebsi") ?? undefined;
  const dest = url.searchParams.get("redirect") ?? (role === "lawyer" ? "/lawyer/dashboard" : "/client/home");

  // For client role: ensure a SCHEMA_CLIENT capability exists. We mint here
  // (rather than via /api/onboarding/attest-client post-sign-in) because the
  // signIn() call below issues an internal NEXT_REDIRECT and we lose control
  // of the response — there's no clean place to add a follow-up POST.
  if (role === "client") {
    const subject = wallet.toLowerCase();
    const already = await hasCapability(subject, SCHEMA_CLIENT);
    if (!already) {
      try {
        const { uid } = await attestVerifiedClient({
          subject,
          claims: { countryOfResidence: "EU", ageOver18: true },
          from: OPERATOR_ADDRESS,
          expiresAt: null,
        });
        // Mirror onto User.clientCapabilityUid if the row already exists. If
        // not, signIn() will create it below; the capability lookup goes by
        // walletAddress on Capability so the row is fine without the back-ref.
        const existing = await prisma.user.findUnique({ where: { walletAddress: subject } });
        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { ageVerifiedAt: new Date(), clientCapabilityUid: uid },
          });
        }
      } catch (err) {
        console.error("[dev-sign-in] attest-client failed", err);
      }
    }
  }

  // Auth.js's signIn throws NEXT_REDIRECT internally on success; let Next handle that.
  await signIn("dev-login", {
    walletAddress: wallet,
    role: role.toUpperCase(),
    ebsiWalletProvider,
    redirectTo: dest,
  });
  return NextResponse.redirect(new URL(dest, url.origin));
}
