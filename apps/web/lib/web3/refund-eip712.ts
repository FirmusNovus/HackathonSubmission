// EIP-712 typed-data definition for the contract's MutualRefundAuthorization.
//
// IMPORTANT: this is the only EIP-712 surface in the codebase whose domain
// MUST match what the contract uses, because the chain-side
// `mutualRefundMilestone(...)` call passes the resulting signatures to
// `_hashTypedDataV4` and `ECDSA.recover`. Anything else and the on-chain
// signer recovery returns the wrong address and the tx reverts.
//
// Contract reference: contracts/src/LegalEngagementEscrow.sol
//   constructor(...) EIP712("LexNovaEscrow", "1") { ... }
//   bytes32 private constant MUTUAL_REFUND_TYPEHASH =
//     keccak256("MutualRefundAuthorization(uint256 engagementId,uint256 milestoneIndex)");
//
// So the platform-side typed data uses the same domain name + version.

import type { Address } from "viem";

export const REFUND_DOMAIN_NAME = "LexNovaEscrow";
export const REFUND_DOMAIN_VERSION = "1";

export const REFUND_TYPES = {
  MutualRefundAuthorization: [
    { name: "engagementId", type: "uint256" },
    { name: "milestoneIndex", type: "uint256" },
  ],
} as const;

export interface RefundAuthorizationPayload {
  engagementId: bigint;
  milestoneIndex: bigint;
}

export function buildRefundDomain(args: {
  chainId: number;
  verifyingContract: Address;
}): {
  name: typeof REFUND_DOMAIN_NAME;
  version: typeof REFUND_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
} {
  return {
    name: REFUND_DOMAIN_NAME,
    version: REFUND_DOMAIN_VERSION,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
  };
}
