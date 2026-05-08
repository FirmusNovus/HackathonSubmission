// DCQL query builders for OID4VP presentations.
// Owner spec: 001-verified-legal-engagement.
//
// PID: discloses ONLY age_equal_or_over.18 + address.country.
// Bar: discloses given_name, family_name, jurisdiction, bar_admission_date,
//      bar_admission_number, valid_until.

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}

export interface DcqlCredentialQuery {
  id: string;
  format: 'dc+sd-jwt' | 'vc+sd-jwt';
  meta: { vct_values: string[] };
  claims: DcqlClaim[];
}

export interface DcqlClaim {
  path: (string | number)[];
}

export const PID_VCT = 'urn:eudi:pid:1';
export const BAR_VCT = 'urn:firmus-novus:LegalProfessionalAccreditation';

export function pidQuery(id = 'pid'): DcqlQuery {
  return {
    credentials: [
      {
        id,
        format: 'dc+sd-jwt',
        meta: { vct_values: [PID_VCT] },
        claims: [
          { path: ['age_equal_or_over', '18'] },
          { path: ['address', 'country'] },
        ],
      },
    ],
  };
}

export function barQuery(id = 'bar'): DcqlQuery {
  return {
    credentials: [
      {
        id,
        format: 'dc+sd-jwt',
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
