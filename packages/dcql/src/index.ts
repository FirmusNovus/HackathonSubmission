/**
 * DCQL query builders for Lex Nova's two presentation flows.
 *
 * Pinned to the validated wwWallet shape from the spike. Anything not in the
 * `claims` array is NOT requested — that is the contract surface that enforces
 * FR-003 (only disclosed-attribute subset reaches the verifier).
 */

export type DcqlQuery = {
  credentials: Array<{
    id: string;
    format: "vc+sd-jwt";
    meta: { vct_values: string[] };
    claims: Array<{ path: string[] }>;
  }>;
};

export const BAR_VCT = "urn:lex-nova:LegalProfessionalAccreditation";
export const PID_VCT = "urn:eudi:pid:1";

export function buildBarDcql(): DcqlQuery {
  return {
    credentials: [
      {
        id: "lawyer-cred",
        format: "vc+sd-jwt",
        meta: { vct_values: [BAR_VCT] },
        claims: [
          { path: ["given_name"] },
          { path: ["family_name"] },
          { path: ["jurisdiction"] },
          { path: ["bar_admission_date"] },
          { path: ["bar_admission_number"] },
          { path: ["valid_until"] },
        ],
      },
    ],
  };
}

/**
 * PID DCQL — what the platform requests from the wallet during onboarding.
 *
 * Asks for: given_name, family_name, age_equal_or_over.18, address.country.
 * The name pair seeds the user's display name (and avatar initials) across
 * the platform; the age + country claims become the on-chain verified-client
 * attestation. The wallet UI shows the user exactly what's being requested;
 * this matches.
 *
 * Earlier versions of this codebase deliberately omitted name fields under a
 * "pseudonymous by default" policy. The current product requires displaying
 * the client's name to their lawyer, so we ask for it explicitly here.
 */
export function buildPidDcql(): DcqlQuery {
  return {
    credentials: [
      {
        id: "pid-cred",
        format: "vc+sd-jwt",
        meta: { vct_values: [PID_VCT] },
        claims: [
          { path: ["given_name"] },
          { path: ["family_name"] },
          { path: ["age_equal_or_over", "18"] },
          { path: ["address", "country"] },
        ],
      },
    ],
  };
}

/**
 * The wwWallet returns vp_token as a JSON-stringified object whose value can
 * be a string OR a single-element array depending on wallet-common version.
 * Both are valid; we accept either. Spike-validated quirk.
 */
export function pickVpFromToken(vpToken: unknown, credentialId: string): string {
  let parsed: unknown = vpToken;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // already-stringified envelope; treat as the SD-JWT VC bytes themselves
      return parsed as string;
    }
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("vp_token is not an object");
  }
  const v = (parsed as Record<string, unknown>)[credentialId];
  if (Array.isArray(v)) return v[0] as string;
  if (typeof v === "string") return v;
  throw new Error(`vp_token has no entry for credential id "${credentialId}"`);
}
