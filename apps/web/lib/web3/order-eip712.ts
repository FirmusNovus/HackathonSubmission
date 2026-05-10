// EIP-712 typed-data definition for a lawyer creating a follow-up order.
//
// Symmetric to booking-eip712 but for the Order model. The lawyer signs
// this when sending a follow-up order to a client; the server recovers the
// signing address and rejects anything that doesn't match the SIWE-bound
// lawyer wallet on the session.

import { keccak256, stringToBytes, type Address, type Hex } from "viem";

export const ORDER_DOMAIN_NAME = "FirmusNovus";
export const ORDER_DOMAIN_VERSION = "1";

export const ORDER_CREATE_TYPES = {
  OrderCreate: [
    { name: "lawyer", type: "address" },
    { name: "engagementId", type: "string" },
    { name: "engagementIdOnChain", type: "uint256" },
    { name: "amountWei", type: "uint256" },
    { name: "descriptionHash", type: "bytes32" },
    { name: "nonce", type: "string" },
  ],
} as const;

export interface OrderCreatePayload {
  lawyer: Address;
  engagementId: string;
  engagementIdOnChain: bigint;
  amountWei: bigint;
  descriptionHash: Hex;
  nonce: string;
}

export function buildOrderDomain(args: {
  chainId: number;
  verifyingContract: Address;
}): {
  name: typeof ORDER_DOMAIN_NAME;
  version: typeof ORDER_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
} {
  return {
    name: ORDER_DOMAIN_NAME,
    version: ORDER_DOMAIN_VERSION,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
  };
}

export function hashOrderDescription(description: string): Hex {
  return keccak256(stringToBytes(description));
}

export function generateOrderNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
