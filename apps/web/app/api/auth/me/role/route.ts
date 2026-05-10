import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

/**
 * Tiny helper that returns the SIWE-bound user's role. Used by WalletButton
 * to short-circuit operator wallet routing (which doesn't need the chain
 * attestation lookup since operators don't have / need PID/bar credentials).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ role: session.user.role });
}
