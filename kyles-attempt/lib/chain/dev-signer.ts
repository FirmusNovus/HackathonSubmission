// =============================================================================
// Dev-only deterministic signer derivation (F4).
// -----------------------------------------------------------------------------
// Pulled out of `lib/chain/eip712.ts` so the auth config can import it
// without dragging `node:crypto` (used by `eip712.ts` for `createHash` /
// `randomBytes`) into the edge-runtime middleware bundle.
//
// Webpack analyses ALL imports of every module in the middleware graph,
// dynamic or otherwise, and it doesn't know how to handle `node:crypto`
// in the edge bundle. The auth-config dev-login authorize path runs on
// the Node runtime, but the same module is imported by `middleware.ts`
// (via the top-level `auth` export) → webpack tries to bundle it for
// edge → boom.
//
// Production REPLACES this entirely: real wallets sign in the browser via
// wagmi, and `User.devSignerAddress` stays null so EIP-712 verification
// recovers to `walletAddress` directly.
// =============================================================================

import { type Address, type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export function devPrivateKeyForWallet(walletAddress: string): Hex {
  const seed = `firmus-novus/dev-key/${walletAddress.toLowerCase()}`;
  return keccak256(toHex(seed)) as Hex;
}

export function devSignerAddressForWallet(walletAddress: string): Address {
  return privateKeyToAccount(devPrivateKeyForWallet(walletAddress)).address;
}
