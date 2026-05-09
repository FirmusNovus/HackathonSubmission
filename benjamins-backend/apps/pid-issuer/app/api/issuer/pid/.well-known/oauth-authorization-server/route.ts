import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const issuerUrl = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const baseUrl = `${issuerUrl}/api/issuer/pid`;
  return NextResponse.json(
    {
      issuer: baseUrl,
      token_endpoint: `${baseUrl}/token`,
      grant_types_supported: ["urn:ietf:params:oauth:grant-type:pre-authorized_code"],
      "pre-authorized_grant_anonymous_access_supported": true,
      dpop_signing_alg_values_supported: ["ES256"],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
