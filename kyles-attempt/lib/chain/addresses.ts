// =============================================================================
// Stable mock addresses for the deployed contract suite.
// -----------------------------------------------------------------------------
// Production swap-in: read `apps/platform/lib/chain/deployed-addresses.json`
// (System A's pattern) — a build-time artifact emitted by the Foundry deploy
// script. For now we hard-code stable hex placeholders so the rest of the
// platform can build URLs / log lines that include them without crashing.
//
// Not yet imported anywhere outside `lib/chain/clients.ts`.
// =============================================================================

export type DeployedAddresses = {
  escrow: `0x${string}`;
  attestationManager: `0x${string}`;
  zkVerifier: `0x${string}`;
};

const PLACEHOLDER: DeployedAddresses = {
  escrow: "0xe5c70011111111111111111111111111111e5c70",
  attestationManager: "0xa771e57a71011111111111111111111111111111",
  zkVerifier: "0x5b00111111111111111111111111111111115b00",
};

export function getDeployedAddresses(): DeployedAddresses {
  return PLACEHOLDER;
}
