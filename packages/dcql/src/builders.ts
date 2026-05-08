/**
 * DCQL query builders for OID4VP presentations. Owner spec: 001.
 *
 * PID — discloses ONLY age_equal_or_over.18 + address.country.
 * Bar — discloses given_name, family_name, jurisdiction,
 *       bar_admission_date, bar_admission_number, valid_until.
 *
 * Pinned to the validated wwWallet shape; anything not in `claims` is NOT
 * requested. This is the contract surface that enforces FR-002 / FR-049.
 */

export type DcqlQuery = {
  credentials: Array<{
    id: string;
    format: 'vc+sd-jwt' | 'dc+sd-jwt';
    meta: { vct_values: string[] };
    claims: Array<{ path: string[] }>;
  }>;
};

export const PID_VCT = 'urn:eudi:pid:1';
export const BAR_VCT = 'urn:firmus-novus:LegalProfessionalAccreditation';

export function pidQuery(id = 'pid-cred'): DcqlQuery {
  return {
    credentials: [
      {
        id,
        format: 'vc+sd-jwt',
        meta: { vct_values: [PID_VCT] },
        claims: [
          { path: ['age_equal_or_over', '18'] },
          { path: ['address', 'country'] },
        ],
      },
    ],
  };
}

export function barQuery(id = 'lawyer-cred'): DcqlQuery {
  return {
    credentials: [
      {
        id,
        format: 'vc+sd-jwt',
        meta: { vct_values: [BAR_VCT] },
        claims: [
          { path: ['given_name'] },
          { path: ['family_name'] },
          { path: ['jurisdiction'] },
          { path: ['bar_admission_date'] },
          { path: ['bar_admission_number'] },
          { path: ['valid_until'] },
        ],
      },
    ],
  };
}

/**
 * The wallet returns vp_token as a JSON-stringified object whose value can
 * be a string OR a single-element array depending on wallet-common version.
 * Both are valid; we accept either. Validated wwWallet quirk.
 */
export function pickVpFromToken(vpToken: unknown, credentialId: string): string {
  let parsed: unknown = vpToken;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // already-stringified envelope; treat as the SD-JWT VC bytes themselves
      return parsed as string;
    }
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('vp_token is not an object');
  }
  const v = (parsed as Record<string, unknown>)[credentialId];
  if (Array.isArray(v)) return v[0] as string;
  if (typeof v === 'string') return v;
  throw new Error(`vp_token has no entry for credential id "${credentialId}"`);
}
