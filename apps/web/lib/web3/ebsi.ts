// ============================================================================
// EBSI (European Blockchain Services Infrastructure) — STUBS
// ----------------------------------------------------------------------------
// In production this module talks to the EBSI Trusted Issuers Registry and the
// user's identity wallet (DS Wallet, eKibisis, eDiplomas, SSI Auth, PwC-ID,
// IDENTFY, PrimusMoney) via OpenID for Verifiable Credentials (OID4VC).
//
// Required production integrations:
//   - Verify lawyer credentials against the EBSI Trusted Issuers Registry
//     (https://ec.europa.eu/digital-building-blocks/sites/display/EBSI/EBSI+Trusted+Issuers+Registry)
//   - Issue Verifiable Credentials back to the lawyer's identity wallet on
//     successful verification (bar admission VC, specialization VCs).
//   - Request the Over18 VC from the client's identity wallet on age check —
//     a boolean attestation, no DOB exchanged.
// ============================================================================

export const EBSI_WALLET_PROVIDERS = [
  { id: "ds", name: "DS Wallet", org: "Digitalsign — Certificadora Digital S.A.", color: "#1F4F8A" },
  { id: "ekibis", name: "eKibisis", org: "Goldman Solutions and Services Ltd", color: "#2A8C76" },
  { id: "edip", name: "eDiplomas Wallet", org: "Greek Universities Network — GUnet", color: "#0B6FB8" },
  { id: "ssi", name: "SSI Auth Wallet", org: "Kung Fu Software", color: "#7A2E5C" },
  { id: "pwc", name: "PwC-ID Holder", org: "PwC", color: "#D04A02" },
  { id: "identfy", name: "IDENTFY", org: "IZERTIS, S.A.", color: "#0A4D7A" },
  { id: "primus", name: "PrimusMoney", org: "Primus Money", color: "#3B5BA9" },
] as const;

export type EbsiWalletProviderId = (typeof EBSI_WALLET_PROVIDERS)[number]["id"];

export function isEbsiWalletProvider(id: string): id is EbsiWalletProviderId {
  return EBSI_WALLET_PROVIDERS.some((p) => p.id === id);
}

export function getEbsiWalletProvider(id: string | null | undefined) {
  if (!id) return null;
  return EBSI_WALLET_PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Stub for the Over18 VC request flow.
 * In production: open the user's identity wallet, request the Over18 VC, verify
 * the signature against the EBSI Trusted Issuers Registry, return the boolean.
 */
export async function requestOver18Credential(_walletProvider: EbsiWalletProviderId): Promise<{ verified: true }> {
  await new Promise((r) => setTimeout(r, 1500));
  return { verified: true };
}

/**
 * Stub for the lawyer credential verification flow.
 * In production: cross-check submitted credentials against the EBSI Trusted
 * Issuers Registry (bar association, university), then issue a verifiable
 * credential back to the lawyer's identity wallet. Returns within 48 hours.
 */
export type EbsiVerificationResult = {
  verified: boolean;
  ebsiCredentialId: string | null;
  reason?: string;
};

export async function verifyLawyerCredentials(_args: {
  userId: string;
  barRegistrationNum: string;
  jurisdiction: string;
}): Promise<EbsiVerificationResult> {
  await new Promise((r) => setTimeout(r, 1000));
  // STUB: always succeeds in dev. Production replaces this with real EBSI calls.
  return {
    verified: true,
    ebsiCredentialId: `ebsi:vc:firmus:${Math.random().toString(36).slice(2, 10)}`,
  };
}

/** TX wallet brands shown in the dual-wallet onboarding step. */
export const TX_WALLET_BRANDS = [
  { id: "metamask", name: "MetaMask", org: "Browser extension · most popular", color: "#E2761B" },
  { id: "wc", name: "WalletConnect", org: "Connect any mobile wallet by QR", color: "#3B99FC" },
  { id: "coinbase", name: "Coinbase Wallet", org: "Coinbase", color: "#0052FF" },
] as const;
