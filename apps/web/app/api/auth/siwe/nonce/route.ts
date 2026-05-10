import { NextResponse } from "next/server";
import { generateNonce } from "siwe";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Issues a single-use SIWE nonce, persists it to the Nonce table so the SIWE
// CredentialsProvider can reject reused / unknown nonces. Nothing here is
// session-sensitive — the nonce is bound to the user only when they sign and
// the address is recovered from the signature.
export async function POST() {
  const nonce = generateNonce();
  await prisma.nonce.create({ data: { nonce } });
  return NextResponse.json({ nonce });
}
