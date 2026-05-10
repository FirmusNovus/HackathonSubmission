import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { getAttestationStatus } from "@/lib/chain/attestations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns whether the signed-in wallet already has on-chain capability
 * attestations. Used by the landing-page "Connect wallet" flow to decide
 * post-signin destination: lawyer→dashboard, client→home, neither→/connect.
 */
export async function GET() {
  const session = await auth();
  const wallet = session?.user?.walletAddress;
  if (!wallet) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const status = await getAttestationStatus(wallet);
  return NextResponse.json(status);
}
