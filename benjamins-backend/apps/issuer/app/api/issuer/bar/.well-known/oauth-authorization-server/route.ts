import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Authorization-server metadata. wwWallet's TokenRequest setup block
 * dereferences `dpopParams.current` and crashes if
 * `dpop_signing_alg_values_supported` is absent, even though our flow doesn't
 * strictly require DPoP.
 */
export async function GET() {
  const issuerUrl = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const baseUrl = `${issuerUrl}/api/issuer/bar`;
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
