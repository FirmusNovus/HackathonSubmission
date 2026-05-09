import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";

export const runtime = "nodejs";

/**
 * Resolve the SIWE-authenticated wallet to a role, if any.
 *
 *   { signedIn: false }                — no SIWE session
 *   { signedIn: true, role: null }     — signed in, no verified_users row → onboard
 *   { signedIn: true, role: "lawyer" } — verified lawyer
 *   { signedIn: true, role: "client" } — verified client
 */
export async function GET() {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ signedIn: false });
  }
  const row = getDb()
    .prepare(
      `SELECT attested_role
       FROM verified_users
       WHERE lower(eth_address) = lower(?)
       ORDER BY attested_at DESC
       LIMIT 1`,
    )
    .get(address) as { attested_role: "lawyer" | "client" | "arbiter" } | undefined;
  return NextResponse.json({
    signedIn: true,
    address,
    role: row?.attested_role ?? null,
  });
}
