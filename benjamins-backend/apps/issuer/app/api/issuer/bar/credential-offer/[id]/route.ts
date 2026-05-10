import { NextResponse } from "next/server";
import { readOfferById } from "@lex-nova/oid4vci";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const row = readOfferById(getDb(), params.id);
  if (!row) {
    return NextResponse.json({ error: "offer_not_found" }, { status: 404 });
  }
  const issuerUrl = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const baseUrl = `${issuerUrl}/api/issuer/bar`;
  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      credential_configuration_ids: ["LegalProfessionalAccreditation_sdjwt"],
      grants: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
          "pre-authorized_code": row.pre_auth_code,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
