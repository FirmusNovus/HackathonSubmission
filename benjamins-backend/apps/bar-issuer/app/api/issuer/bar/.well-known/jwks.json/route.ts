import { NextResponse } from "next/server";
import { readPublicJwk } from "@/lib/keys";

export const runtime = "nodejs";

export async function GET() {
  const jwk = await readPublicJwk();
  return NextResponse.json(
    { keys: [jwk] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
