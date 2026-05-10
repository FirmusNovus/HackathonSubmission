import { NextResponse } from "next/server";
import { issuerBaseUrl } from "@/lib/keys";

export const runtime = "nodejs";

export async function GET() {
  const baseUrl = issuerBaseUrl("pid");

  return NextResponse.json(
    {
      credential_issuer: baseUrl,
      authorization_servers: [baseUrl],
      credential_endpoint: `${baseUrl}/credential`,
      batch_credential_issuance: { batch_size: 5 },
      credential_configurations_supported: {
        EudiPid_sdjwt: {
          format: "vc+sd-jwt",
          scope: "EudiPid",
          cryptographic_binding_methods_supported: ["did:key", "jwk"],
          credential_signing_alg_values_supported: ["ES256"],
          proof_types_supported: {
            jwt: { proof_signing_alg_values_supported: ["ES256"] },
          },
          vct: "urn:eudi:pid:1",
          credential_metadata: {
            display: [
              {
                name: "Person Identification Data",
                description:
                  "EUDI Person Identification Data — government-issued identity attestation.",
                locale: "en-GB",
                background_color: "#003399",
                text_color: "#ffffff",
                background_image: { uri: `${baseUrl}/card-art/marta-sanchez.svg` },
              },
            ],
            claims: [
              { path: ["given_name"], display: [{ name: "First name", locale: "en-GB" }] },
              { path: ["family_name"], display: [{ name: "Last name", locale: "en-GB" }] },
              { path: ["birthdate"], display: [{ name: "Date of birth", locale: "en-GB" }] },
              { path: ["birth_given_name"], display: [{ name: "Birth first name", locale: "en-GB" }] },
              { path: ["birth_family_name"], display: [{ name: "Birth last name", locale: "en-GB" }] },
              { path: ["nationalities"], display: [{ name: "Nationalities", locale: "en-GB" }] },
              { path: ["sex"], display: [{ name: "Sex", locale: "en-GB" }] },
              { path: ["email"], display: [{ name: "Email", locale: "en-GB" }] },
              { path: ["phone_number"], display: [{ name: "Mobile", locale: "en-GB" }] },
              { path: ["place_of_birth", "locality"], display: [{ name: "City of birth", locale: "en-GB" }] },
              { path: ["place_of_birth", "region"], display: [{ name: "Region of birth", locale: "en-GB" }] },
              { path: ["place_of_birth", "country"], display: [{ name: "Country of birth", locale: "en-GB" }] },
              { path: ["address", "formatted"], display: [{ name: "Full address", locale: "en-GB" }] },
              { path: ["address", "street_address"], display: [{ name: "Street", locale: "en-GB" }] },
              { path: ["address", "house_number"], display: [{ name: "Street no.", locale: "en-GB" }] },
              { path: ["address", "postal_code"], display: [{ name: "ZIP", locale: "en-GB" }] },
              { path: ["address", "locality"], display: [{ name: "City", locale: "en-GB" }] },
              { path: ["address", "region"], display: [{ name: "State / region", locale: "en-GB" }] },
              { path: ["address", "country"], display: [{ name: "Country", locale: "en-GB" }] },
              { path: ["age_equal_or_over", "14"], display: [{ name: "Age ≥ 14", locale: "en-GB" }] },
              { path: ["age_equal_or_over", "16"], display: [{ name: "Age ≥ 16", locale: "en-GB" }] },
              { path: ["age_equal_or_over", "18"], display: [{ name: "Age ≥ 18", locale: "en-GB" }] },
              { path: ["age_equal_or_over", "21"], display: [{ name: "Age ≥ 21", locale: "en-GB" }] },
              { path: ["age_equal_or_over", "65"], display: [{ name: "Age ≥ 65", locale: "en-GB" }] },
              { path: ["age_in_years"], display: [{ name: "Age", locale: "en-GB" }] },
              { path: ["age_birth_year"], display: [{ name: "Birth year", locale: "en-GB" }] },
              { path: ["personal_administrative_number"], display: [{ name: "Personal ID", locale: "en-GB" }] },
              { path: ["document_number"], display: [{ name: "Document number", locale: "en-GB" }] },
              { path: ["issuing_authority"], display: [{ name: "Issuing authority", locale: "en-GB" }] },
              { path: ["issuing_country"], display: [{ name: "Issuing country", locale: "en-GB" }] },
              { path: ["issuing_jurisdiction"], display: [{ name: "Issuing region", locale: "en-GB" }] },
              { path: ["date_of_expiry"], display: [{ name: "Expiry date", locale: "en-GB" }] },
              { path: ["date_of_issuance"], display: [{ name: "Issue date", locale: "en-GB" }] },
            ],
          },
        },
      },
      display: [
        { name: "Lex Nova — Stand-in PID Issuer", locale: "en-GB" },
      ],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
