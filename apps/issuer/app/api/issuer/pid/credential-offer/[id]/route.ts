import { NextResponse } from "next/server";
import { readOfferById } from "@firmus/oid4vci";
import { getDb } from "@/lib/db";
import { issuerBaseUrl } from "@/lib/keys";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = readOfferById(getDb(), (await params).id);
  if (!row) {
    return NextResponse.json({ error: "offer_not_found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      credential_issuer: issuerBaseUrl("pid"),
      credential_configuration_ids: ["EudiPid_sdjwt"],
      grants: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
          "pre-authorized_code": row.pre_auth_code,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
