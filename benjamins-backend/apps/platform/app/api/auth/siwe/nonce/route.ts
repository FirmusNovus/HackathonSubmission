import { NextResponse } from "next/server";
import { createNonce } from "@/lib/siwe";
import { setNonceCookie } from "@/lib/siwe/session";

export const runtime = "nodejs";

export async function GET() {
  const nonce = createNonce();
  setNonceCookie(nonce);
  return NextResponse.json({ nonce });
}
