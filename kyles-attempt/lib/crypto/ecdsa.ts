"use client";

/**
 * F8 — ECDSA secp256k1 message signatures.
 *
 * In production: the signing path is the user's wallet (wagmi
 * `signMessageAsync`), so `signMessage` here is a thin wrapper around a
 * caller-supplied signer. The dev/test fallback uses viem's
 * `privateKeyToAccount` over a deterministic seed (see `lib/crypto/dev-keys.ts`).
 *
 * Verification uses viem's `verifyMessage` / `recoverMessageAddress`.
 *
 * Note: even though viem itself is environment-agnostic, this module is
 * "use client" tagged because the signing flow assumes a wallet/wagmi
 * context. The CI gate (`scripts/check-no-server-decryption.sh`) keeps
 * server bundles free of all `lib/crypto/*` imports.
 */

import {
  type Address,
  type Hex,
  hashMessage,
  recoverMessageAddress,
  verifyMessage as viemVerifyMessage,
} from "viem";

import { assertSubtleCrypto } from "./index";

export interface MessageSigner {
  /** Wagmi-shaped signer — `signMessage({ message })` returns a `0x…` hex sig. */
  signMessage: (args: { message: string }) => Promise<Hex>;
}

/**
 * Sign a UTF-8 message with the supplied signer. Returns the hex signature.
 *
 * The signer abstraction lets the room pass either:
 *   - the wagmi `signMessageAsync` (production)
 *   - the dev-signer derived from `lib/crypto/dev-keys.ts` (tests / local)
 */
export async function signMessage(
  message: string,
  signer: MessageSigner,
): Promise<Hex> {
  // No subtle calls here, but we still gate on a browser context so the
  // module load itself fails fast in any accidental server import path.
  assertSubtleCrypto();
  return signer.signMessage({ message });
}

/**
 * Verify that `signature` over `message` recovers to `address`. Returns
 * `false` (not throws) on any mismatch. Wraps viem's `verifyMessage`.
 */
export async function verifyMessageSignature(args: {
  address: Address;
  message: string;
  signature: Hex;
}): Promise<boolean> {
  return viemVerifyMessage({
    address: args.address,
    message: args.message,
    signature: args.signature,
  });
}

export async function recoverMessageSigner(args: {
  message: string;
  signature: Hex;
}): Promise<Address> {
  return recoverMessageAddress({
    message: args.message,
    signature: args.signature,
  });
}

/**
 * Canonical message format for an encrypted message envelope. Mirrors A's
 * `envelopeMessage` in `packages/crypto/src/sign.ts`. Hashed and signed by
 * the sender so receivers can prove origin.
 */
export function envelopeMessage(args: {
  conversationId: string;
  senderIndex: number;
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
}): string {
  return [
    "firmus-novus/v1/message",
    `conversation:${args.conversationId}`,
    `index:${args.senderIndex}`,
    `ct:${args.ciphertextB64}`,
    `iv:${args.ivB64}`,
    `salt:${args.saltB64}`,
  ].join("\n");
}

/** Convenience: hash an envelope message the way viem's verifier does. */
export function hashEnvelopeMessage(args: {
  conversationId: string;
  senderIndex: number;
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
}): Hex {
  return hashMessage(envelopeMessage(args));
}
