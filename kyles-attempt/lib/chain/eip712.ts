// =============================================================================
// EIP-712 typed-data signing + verification (F4).
// -----------------------------------------------------------------------------
// The escrow contract verifies two off-chain typed-data shapes:
//
//   1. ProposalOffer — lawyer-signed offer for a follow-up proposal. The
//      client's `fundProposal` calldata recomputes the digest from
//      (engagementId, amount, itemsHash, nonce) and recovers the signer; if
//      it doesn't match the engagement's lawyer, the call reverts. Used in
//      F4 (this feature) for follow-up proposals after the consultation.
//
//   2. MutualRefundAuthorization — both parties sign over (engagementId,
//      proposalIndex). Recovered + checked inside `mutualRefundProposal`.
//      Helpers shipped now (F4) so F6 can drop in without re-deriving the
//      domain. The escrow `MUTUAL_REFUND_TYPEHASH` constant in
//      `LegalEngagementEscrow.sol` matches the encoding here byte-for-byte.
//
// All cryptography goes through viem's `signTypedData` /
// `recoverTypedDataAddress` so the wire-format matches MetaMask's
// `eth_signTypedData_v4`. The mock chain doesn't lessen the cryptographic
// guarantees — signature verification is REAL even though state changes
// are persisted via Prisma instead of an EVM RPC.
//
// Items hash & nonce
// ------------------
// `itemsHash` commits the lawyer to a specific bag of (line items +
// deliverables). The canonical form sorts object keys recursively so two
// representations of the same logical content produce the same digest.
// `nonce` is 32 random bytes minted off-chain when the lawyer composes the
// offer; the escrow burns it inside `fundProposal` via the
// `ConsumedProposalNonce` mirror table to prevent replay.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import {
  type Address,
  type Hex,
  recoverTypedDataAddress,
  verifyTypedData,
} from "viem";
import { signTypedData } from "viem/accounts";
import { getDeployedAddresses } from "@/lib/chain/addresses";
import { InvalidOfferSignature, InvalidRefundSignature } from "@/lib/chain/errors";

// =============================================================================
// Domain.
// =============================================================================

/**
 * Mock chain id 1 — the production escrow gets pinned to whatever chain the
 * Foundry deploy script targets, but for the in-DB mock the EIP-712 domain
 * just needs to be stable so signatures round-trip. The `name`/`version`
 * pair must mirror `EIP712("FirmusNovusEscrow", "1")` in the Solidity
 * constructor (line 132 of `LegalEngagementEscrow.sol`).
 */
export const MOCK_CHAIN_ID = 1;

export function escrowDomain() {
  return {
    name: "FirmusNovusEscrow",
    version: "1",
    chainId: MOCK_CHAIN_ID,
    verifyingContract: getDeployedAddresses().escrow,
  } as const;
}

// =============================================================================
// Types — EIP-712 typed-data field schemas. The order + types here are
// load-bearing: changing them changes the digest. Mirror exactly what the
// Solidity contract abi.encodes inside its TYPEHASH literal.
// =============================================================================

export const PROPOSAL_OFFER_TYPES = {
  ProposalOffer: [
    { name: "engagementId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "itemsHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const MUTUAL_REFUND_TYPES = {
  MutualRefundAuthorization: [
    { name: "engagementId", type: "uint256" },
    { name: "proposalIndex", type: "uint256" },
  ],
} as const;

// =============================================================================
// Message shapes.
// =============================================================================

export interface ProposalOfferMessage {
  engagementId: bigint;
  amount: bigint;
  itemsHash: Hex;
  nonce: Hex;
}

export interface MutualRefundMessage {
  engagementId: bigint;
  proposalIndex: bigint;
}

/**
 * Convenience: callers usually have wei amounts as decimal strings. This
 * normalises a string|number|bigint into the bigint shape viem requires.
 */
export function toBigInt(v: bigint | number | string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(v);
}

// =============================================================================
// Canonical items hash.
// -----------------------------------------------------------------------------
// Hash committed to in the offer. Both parties must produce the same digest
// from the same logical (line items, deliverables) tuple. To keep that
// stable we:
//   1. Strip undefined values (so a missing field doesn't differ from a
//      field set to undefined).
//   2. Sort object keys deeply.
//   3. JSON.stringify the result with no whitespace.
//   4. SHA-256 the UTF-8 bytes.
//
// SHA-256 is used here (not keccak256) because itemsHash is purely a
// platform-level commitment; the escrow contract never re-derives it. If
// production ever moves the items into calldata, switch to keccak256 to
// match the EVM's native hash.
// =============================================================================

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      out[k] = sortDeep(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

/**
 * Compute the items-hash for an offer over (line items + deliverables).
 * Returns a 0x-prefixed 32-byte hex string suitable for use as a `bytes32`
 * field in the EIP-712 message.
 */
export function canonicalItemsHash(items: unknown, deliverables: unknown): Hex {
  const canonical = canonicalJson({ items, deliverables });
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `0x${digest}` as Hex;
}

/**
 * Mint a fresh 32-byte nonce. Cryptographically random — the escrow burns
 * it via `ConsumedProposalNonce` on first fund, so a replay of the same
 * `(itemsHash, nonce, sig)` tuple deterministically fails.
 */
export function generateOfferNonce(): Hex {
  return `0x${randomBytes(32).toString("hex")}` as Hex;
}

// =============================================================================
// Signing + verification — ProposalOffer.
// =============================================================================

/**
 * Sign a `ProposalOffer` with a private key. Library code so it works in
 * both browser (via wagmi/viem's `signTypedData`) and server (test-only
 * dev path that uses a deterministic seeded key per persona — see
 * `devPrivateKeyForWallet` below). Returns `{signature}`; the digest is
 * computed inside viem and isn't exposed.
 */
export async function signProposalOffer(args: {
  message: ProposalOfferMessage;
  privateKey: Hex;
}): Promise<{ signature: Hex }> {
  const signature = await signTypedData({
    privateKey: args.privateKey,
    domain: escrowDomain(),
    types: PROPOSAL_OFFER_TYPES,
    primaryType: "ProposalOffer",
    message: args.message,
  });
  return { signature };
}

/**
 * Recover the address that signed a ProposalOffer. The signature is
 * malformed if it isn't 65-byte (r || s || v) hex; viem throws in that
 * case and we let it bubble.
 */
export async function recoverProposalOfferSigner(args: {
  message: ProposalOfferMessage;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: escrowDomain(),
    types: PROPOSAL_OFFER_TYPES,
    primaryType: "ProposalOffer",
    message: args.message,
    signature: args.signature,
  });
}

/**
 * Assert the signature recovers to `expectedSigner`. Throws
 * `InvalidOfferSignature` on any mismatch (recovery failure, address
 * mismatch). Comparison is case-insensitive — viem returns checksummed
 * addresses; expectedSigner may come from a lower-cased DB column.
 */
export async function verifyProposalOfferSig(args: {
  message: ProposalOfferMessage;
  signature: Hex;
  expectedSigner: string;
}): Promise<void> {
  let recovered: Address;
  try {
    recovered = await recoverProposalOfferSigner({
      message: args.message,
      signature: args.signature,
    });
  } catch {
    throw new InvalidOfferSignature("signature is malformed");
  }
  if (recovered.toLowerCase() !== args.expectedSigner.toLowerCase()) {
    throw new InvalidOfferSignature("recovered signer does not match expected lawyer wallet");
  }
}

// =============================================================================
// Signing + verification — MutualRefundAuthorization (shipped for F6).
// =============================================================================

export async function signMutualRefund(args: {
  message: MutualRefundMessage;
  privateKey: Hex;
}): Promise<{ signature: Hex }> {
  const signature = await signTypedData({
    privateKey: args.privateKey,
    domain: escrowDomain(),
    types: MUTUAL_REFUND_TYPES,
    primaryType: "MutualRefundAuthorization",
    message: args.message,
  });
  return { signature };
}

export async function recoverMutualRefundSigner(args: {
  message: MutualRefundMessage;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: escrowDomain(),
    types: MUTUAL_REFUND_TYPES,
    primaryType: "MutualRefundAuthorization",
    message: args.message,
    signature: args.signature,
  });
}

export async function verifyMutualRefundSig(args: {
  message: MutualRefundMessage;
  signature: Hex;
  expectedSigner: string;
}): Promise<void> {
  let recovered: Address;
  try {
    recovered = await recoverMutualRefundSigner({
      message: args.message,
      signature: args.signature,
    });
  } catch {
    throw new InvalidRefundSignature("signature is malformed");
  }
  if (recovered.toLowerCase() !== args.expectedSigner.toLowerCase()) {
    throw new InvalidRefundSignature("recovered signer does not match expected wallet");
  }
}

/**
 * Pure verifyMutualRefundSig sibling that returns boolean instead of
 * throwing — useful when the caller needs to attempt-then-fall-back rather
 * than abort. Mirrors viem's own `verifyTypedData` shape.
 */
export async function isValidMutualRefundSig(args: {
  message: MutualRefundMessage;
  signature: Hex;
  signer: Address;
}): Promise<boolean> {
  return verifyTypedData({
    address: args.signer,
    domain: escrowDomain(),
    types: MUTUAL_REFUND_TYPES,
    primaryType: "MutualRefundAuthorization",
    message: args.message,
    signature: args.signature,
  });
}

// =============================================================================
// Dev-only deterministic keys.
// -----------------------------------------------------------------------------
// Seeded personas (lawyers + clients in `prisma/seed.ts`) carry hand-picked
// wallet addresses (`0x1111…`, `0x2222…`) that aren't real EOA addresses —
// no real private key recovers to them. For the dev/test EIP-712 path we
// derive a deterministic secp256k1 key from the seeded wallet (see
// `lib/chain/dev-signer.ts`).
//
// The address that pk recovers to is mirrored onto the User row as
// `devSignerAddress`. Verification routes accept a recovered signer that
// matches EITHER `walletAddress` (production: real MetaMask sig over the
// user's actual EOA) OR `devSignerAddress` (dev/test: the derived persona
// key signed). This keeps the existing seeded addresses stable while
// letting the cryptography stay byte-for-byte real.
//
// Production REPLACES this entirely: real wallets sign in the browser via
// wagmi's `useSignTypedData`, and `devSignerAddress` is null so only the
// EOA recovery path applies.
// =============================================================================

export { devPrivateKeyForWallet, devSignerAddressForWallet } from "./dev-signer";

/**
 * Production-hazard guard for the dev-signer fallback. The dev-signer key
 * is *publicly derivable* (`keccak256("firmus-novus/dev-key/" + wallet)`)
 * because every seeded persona's private key has to be reproducible from
 * the wallet alone. Accepting it in a production deploy would let any
 * attacker who knows a user's wallet address forge a ProposalOffer
 * signature as them. This must therefore be disabled outside dev/test.
 *
 * The gate matches the rest of the dev surface (lib/auth/config.ts,
 * /api/dev/*): allowed iff NODE_ENV !== "production" OR ENABLE_MOCK_AUTH
 * === "true". The Playwright suite runs against a `next build` with
 * NODE_ENV=production and sets ENABLE_MOCK_AUTH=true so seeded personas
 * keep working there; a real deploy without the env var falls back to
 * canonical-wallet-only recovery.
 */
export function devSignerFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_AUTH === "true";
}

/**
 * Verify a ProposalOffer signature. In dev/test, recovery to either the
 * canonical wallet OR the seeded dev-signer alias is accepted (so seeded
 * `0x1111…` personas can keep using deterministic keys). In production,
 * ONLY recovery to `walletAddress` is accepted — the dev-signer fallback
 * is gated off because its private key is publicly derivable. Throws
 * `InvalidOfferSignature` on any mismatch.
 */
export async function verifyProposalOfferSigForUser(args: {
  message: ProposalOfferMessage;
  signature: Hex;
  walletAddress: string;
  devSignerAddress?: string | null;
}): Promise<{ recovered: Address }> {
  let recovered: Address;
  try {
    recovered = await recoverProposalOfferSigner({
      message: args.message,
      signature: args.signature,
    });
  } catch {
    throw new InvalidOfferSignature("signature is malformed");
  }
  const wallet = args.walletAddress.toLowerCase();
  const rec = recovered.toLowerCase();
  if (rec === wallet) return { recovered };
  if (devSignerFallbackEnabled()) {
    const dev = args.devSignerAddress?.toLowerCase();
    if (dev && rec === dev) return { recovered };
  }
  throw new InvalidOfferSignature("recovered signer does not match expected lawyer wallet");
}

/**
 * F6: MutualRefundAuthorization counterpart of `verifyProposalOfferSigForUser`.
 * Recovers the signer of a (engagementId, proposalIndex) typed-data signature
 * and asserts it matches either:
 *   - `walletAddress` (production: real EOA), or
 *   - `devSignerAddress` (dev/test: seeded persona alias) — gated by
 *     `devSignerFallbackEnabled()`.
 *
 * Throws `InvalidRefundSignature` on malformed sig OR mismatched recovery.
 * Mirrors the dual-recovery acceptance from F4 so seeded personas + real
 * MetaMask sigs both flow through the same code path.
 */
export async function verifyMutualRefundSigForUser(args: {
  message: MutualRefundMessage;
  signature: Hex;
  walletAddress: string;
  devSignerAddress?: string | null;
}): Promise<{ recovered: Address }> {
  let recovered: Address;
  try {
    recovered = await recoverMutualRefundSigner({
      message: args.message,
      signature: args.signature,
    });
  } catch {
    throw new InvalidRefundSignature("signature is malformed");
  }
  const wallet = args.walletAddress.toLowerCase();
  const rec = recovered.toLowerCase();
  if (rec === wallet) return { recovered };
  if (devSignerFallbackEnabled()) {
    const dev = args.devSignerAddress?.toLowerCase();
    if (dev && rec === dev) return { recovered };
  }
  throw new InvalidRefundSignature("recovered signer does not match expected wallet");
}
