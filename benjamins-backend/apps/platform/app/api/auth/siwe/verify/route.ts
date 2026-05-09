import { NextRequest, NextResponse } from "next/server";
import { verifySiwe } from "@/lib/siwe";
import { clearNonceCookie, getNonceCookie, setSessionCookie } from "@/lib/siwe/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { message, signature } = (await req.json()) as { message?: string; signature?: string };
  if (!message || !signature) {
    return NextResponse.json({ ok: false, reason: "missing message or signature" }, { status: 400 });
  }

  const expectedNonce = getNonceCookie();
  if (!expectedNonce) {
    return NextResponse.json({ ok: false, reason: "no nonce in session — fetch /nonce first" }, { status: 400 });
  }

  const result = await verifySiwe(message, signature, expectedNonce);
  if (!result.ok || !result.address) {
    return NextResponse.json({ ok: false, reason: result.reason ?? "verification failed" }, { status: 401 });
  }

  setSessionCookie(result.address);
  clearNonceCookie();
  return NextResponse.json({ ok: true, address: result.address });
}
