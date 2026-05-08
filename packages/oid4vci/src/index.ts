// OID4VCI flow helpers — pre-auth code state, token, holder-proof verify.
// Owner spec: 001-verified-legal-engagement.

export interface PreAuthCode {
  code: string;
  subjectAddress: string;
  credentialType: 'pid' | 'bar';
  expiresAt: number;
  consumed: boolean;
}

export interface AccessToken {
  token: string;
  cNonce: string;
  subjectAddress: string;
  credentialType: 'pid' | 'bar';
  expiresAt: number;
}

export const OFFER_TTL_SECONDS = 600;
export const ACCESS_TOKEN_TTL_SECONDS = 600;
