import { NextResponse } from "next/server";
import { readState } from "@/lib/verifier/state";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { state: string } }) {
  const row = readState(params.state);
  if (!row) {
    return NextResponse.json({ error: "unknown state" }, { status: 404 });
  }
  // Return raw JWS; wallet expects application/oauth-authz-req+jwt
  return new NextResponse(row.request_jws, {
    headers: {
      "Content-Type": "application/oauth-authz-req+jwt",
      "Cache-Control": "no-store",
    },
  });
}
