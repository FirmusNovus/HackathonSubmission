import { NextRequest, NextResponse } from "next/server";
import { issueAccessToken } from "@firmus/oid4vci";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let body: Record<string, string>;
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    body = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
  } else {
    body = (await req.json()) as Record<string, string>;
  }

  if (body.grant_type !== "urn:ietf:params:oauth:grant-type:pre-authorized_code") {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
  const preAuthCode = body["pre-authorized_code"];
  if (!preAuthCode) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const issued = issueAccessToken(getDb(), preAuthCode, body.tx_code);
  if (!issued) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  return NextResponse.json(
    {
      access_token: issued.access_token,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      c_nonce: issued.c_nonce,
      c_nonce_expires_in: 300,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
