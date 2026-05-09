/**
 * ECDSA secp256k1 wallet signatures. Used to sign:
 *   - engagement proposals/counters in the negotiation chain
 *   - encrypted message envelopes
 *   - V2 follow-up milestone offers + delivery attestations (personal_sign)
 *   - V2 mutual refund authorizations (EIP-712 typed data)
 *
 * Wraps viem so client-side code uses wagmi's signMessage and server-side
 * verification uses viem's verifyMessage. The server never has a private key
 * for a client/lawyer/arbiter wallet.
 */
import {
  type Address,
  type Hex,
  recoverMessageAddress,
  recoverTypedDataAddress,
  verifyMessage,
  verifyTypedData,
} from "viem";

export async function verifyMessageSignature(args: {
  address: Address;
  message: string;
  signature: Hex;
}): Promise<boolean> {
  return verifyMessage({
    address: args.address,
    message: args.message,
    signature: args.signature,
  });
}

export async function recoverSigner(message: string, signature: Hex): Promise<Address> {
  return recoverMessageAddress({ message, signature });
}

/**
 * Canonical message format for an engagement proposal/counter. Hashed and
 * signed with the proposer's wallet key. The server stores the signature
 * alongside the proposal row and verifies before persisting.
 */
export function proposalMessage(args: {
  matterId: number;
  amountWei: string;
  note: string;
  prevProposalId: number | null;
}): string {
  return [
    "lex-nova/v1/proposal",
    `matter:${args.matterId}`,
    `amount_wei:${args.amountWei}`,
    `note:${args.note}`,
    `prev:${args.prevProposalId ?? "none"}`,
  ].join("\n");
}

/**
 * Canonical message format for an encrypted message envelope. Hashed and
 * signed by the sender's wallet so receivers can prove origin.
 */
export function envelopeMessage(args: {
  engagementId: number;
  ciphertextHashHex: string;
  ivHex: string;
  saltHex: string;
}): string {
  return [
    "lex-nova/v1/message",
    `engagement:${args.engagementId}`,
    `ct_hash:${args.ciphertextHashHex}`,
    `iv:${args.ivHex}`,
    `salt:${args.saltHex}`,
  ].join("\n");
}

/**
 * V2 follow-up milestone offer (`MilestoneOffer`). Either party may sign
 * one to propose a follow-up milestone in-engagement. The client's
 * `fundMilestone(engagementId, amount)` call materializes the on-chain
 * milestone using the agreed amount; the contract trusts the funded
 * amount and the server-side platform layer verifies this signature
 * before accepting the offer for storage.
 *
 * The nonce is client-chosen and used purely for off-chain replay
 * protection (so the same offer can't be re-submitted to undo a
 * supersession). The contract itself does not consume the nonce.
 */
export function milestoneOfferMessage(args: {
  engagementId: number;
  amountWei: string;
  note: string;
  nonce: string;
}): string {
  return [
    "lex-nova/v2/milestone-offer",
    `engagement:${args.engagementId}`,
    `amount_wei:${args.amountWei}`,
    `note:${args.note}`,
    `nonce:${args.nonce}`,
  ].join("\n");
}

/**
 * V3 dispute bundle (`DisputeBundle`). The disputing party signs a
 * canonical message tying the encrypted bundle's ciphertext hash to the
 * (engagement_id, milestone_index) it covers, so the platform can verify
 * the SIWE-bound caller authored the upload (anti-spoof) and so the
 * operator-as-arbiter has a non-repudiable record of who filed what.
 */
export function disputeBundleMessage(args: {
  engagementId: number;
  milestoneIndex: number;
  ciphertextHashHex: string;
}): string {
  return [
    "lex-nova/v1/dispute-bundle",
    `engagement:${args.engagementId}`,
    `milestone:${args.milestoneIndex}`,
    `ct_hash:${args.ciphertextHashHex}`,
  ].join("\n");
}

/**
 * V2 delivery attestation (`DeliveryAttestation`). Lawyer-signed off-chain
 * "delivered" record posted into the engagement transcript. The chat
 * surfaces it as a special bubble; arbiters can use it as evidence in a
 * dispute. Distinct from the on-chain `markDelivered` action, which the
 * lawyer only invokes when they need to start the escalation cooldown
 * clock against an unresponsive client.
 */
export function deliveryAttestationMessage(args: {
  engagementId: number;
  milestoneIndex: number;
  deliveredAt: number;
  message: string;
}): string {
  return [
    "lex-nova/v2/delivery-attestation",
    `engagement:${args.engagementId}`,
    `milestone:${args.milestoneIndex}`,
    `delivered_at:${args.deliveredAt}`,
    `message:${args.message}`,
  ].join("\n");
}

// ============================================================
// EIP-712: MutualRefundAuthorization
// ============================================================

/**
 * EIP-712 domain for the V2 escrow. Must mirror the values the contract
 * passed to `EIP712("LexNovaEscrow", "1")` so the digest the wallet signs
 * matches the digest the contract recomputes inside `mutualRefundMilestone`.
 *
 * The verifying contract address and chain id are call-site arguments
 * because both vary across chains/deployments — the platform reads them
 * from the deployed-addresses JSON.
 */
export function mutualRefundDomain(args: {
  chainId: number;
  verifyingContract: Address;
}) {
  return {
    name: "LexNovaEscrow",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
  } as const;
}

export const MUTUAL_REFUND_TYPES = {
  MutualRefundAuthorization: [
    { name: "engagementId", type: "uint256" },
    { name: "milestoneIndex", type: "uint256" },
  ],
} as const;

export interface MutualRefundMessage {
  engagementId: bigint;
  milestoneIndex: bigint;
}

/**
 * Server-side verification of a wallet-signed `MutualRefundAuthorization`.
 * Returns true iff `signature` recovers to `address` over the canonical
 * EIP-712 digest using the supplied domain. Used by the platform's API
 * before persisting either party's row in `refund_authorizations`.
 */
export async function verifyMutualRefundSignature(args: {
  address: Address;
  domain: ReturnType<typeof mutualRefundDomain>;
  message: MutualRefundMessage;
  signature: Hex;
}): Promise<boolean> {
  return verifyTypedData({
    address: args.address,
    domain: args.domain,
    types: MUTUAL_REFUND_TYPES,
    primaryType: "MutualRefundAuthorization",
    message: args.message,
    signature: args.signature,
  });
}

export async function recoverMutualRefundSigner(args: {
  domain: ReturnType<typeof mutualRefundDomain>;
  message: MutualRefundMessage;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: args.domain,
    types: MUTUAL_REFUND_TYPES,
    primaryType: "MutualRefundAuthorization",
    message: args.message,
    signature: args.signature,
  });
}
