import { NextResponse } from "next/server";
import { readState } from "@/lib/verifier/state";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ state: string }> }) {
  const row = await readState((await params).state);
  if (!row) {
    return NextResponse.json({ error: "unknown state" }, { status: 404 });
  }
  if (row.status === "pending") {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }
  if (row.status === "rejected") {
    return NextResponse.json({ status: "rejected", reason: row.rejected_reason }, { status: 400 });
  }
  return NextResponse.json({
    status: "verified",
    kind: row.kind,
    verifiedAttrs: row.verified_attrs ? JSON.parse(row.verified_attrs) : {},
    holderJwk: row.holder_jwk ? JSON.parse(row.holder_jwk) : null,
  });
}
