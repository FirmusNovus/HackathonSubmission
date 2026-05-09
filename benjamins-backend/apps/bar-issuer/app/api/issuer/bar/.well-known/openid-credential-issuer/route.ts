import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const issuerUrl = process.env.PUBLIC_HOSTNAME?.replace(/\/$/, "") ?? "http://localhost:3000";
  const baseUrl = `${issuerUrl}/api/issuer/bar`;

  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      authorization_servers: [baseUrl],
      credential_endpoint: `${baseUrl}/credential`,
      batch_credential_issuance: { batch_size: 5 },
      credential_configurations_supported: {
        LegalProfessionalAccreditation_sdjwt: {
          format: "vc+sd-jwt",
          scope: "LegalProfessionalAccreditation",
          cryptographic_binding_methods_supported: ["did:key", "jwk"],
          credential_signing_alg_values_supported: ["ES256"],
          proof_types_supported: {
            jwt: { proof_signing_alg_values_supported: ["ES256"] },
          },
          vct: "urn:lex-nova:LegalProfessionalAccreditation",
          credential_metadata: {
            display: [
              {
                name: "Legal Professional Accreditation",
                description:
                  "Bar association attestation that the holder is admitted to practise law.",
                locale: "en-GB",
                background_color: "#1e3a8a",
                text_color: "#f5f5f5",
                background_image: { uri: `${baseUrl}/card-art/anna-schmidt.svg` },
              },
            ],
            claims: [
              { path: ["given_name"], display: [{ name: "First name", locale: "en-GB" }] },
              { path: ["family_name"], display: [{ name: "Family name", locale: "en-GB" }] },
              { path: ["jurisdiction"], display: [{ name: "Jurisdiction", locale: "en-GB" }] },
              {
                path: ["bar_admission_date"],
                display: [{ name: "Admitted to bar", locale: "en-GB" }],
              },
              {
                path: ["bar_admission_number"],
                display: [{ name: "Bar admission no.", locale: "en-GB" }],
              },
              { path: ["valid_until"], display: [{ name: "Valid until", locale: "en-GB" }] },
            ],
          },
        },
      },
      display: [
        {
          name: "Lex Nova — Stand-in Bar Issuer",
          locale: "en-GB",
        },
      ],
    },
    {
      // Validated wwWallet quirk: metadata is cached for 30 days otherwise.
      headers: { "Cache-Control": "no-store" },
    }
  );
}
