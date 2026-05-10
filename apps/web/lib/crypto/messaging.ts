// End-to-end message encryption using NaCl box (X25519 ECDH + xsalsa20-poly1305).
//
// Threat model: the platform server stores messages on behalf of two parties
// who already trust each other end-to-end. We don't want the platform to be
// able to read message bodies, even if compromised. Wallet signatures + chain
// state already cover non-repudiation; this module just hides the contents.
//
// Key derivation: each wallet signs a fixed personal message
// ("Firmus Novus messaging key v1"). We hash the resulting signature and use
// it as the seed for an X25519 keypair. This means:
//   - The keypair is deterministic per wallet (no separate key store).
//   - A different signed message would produce a different keypair, so we
//     can rotate / version cleanly.
//   - The user can rederive their privkey on any device by re-signing the
//     same message.
//
// Wire format on the server: each Message row has
//   ciphertext                 base64
//   nonce                      base64 (24 bytes)
//   senderEncryptionPublicKey  base64 (32 bytes — the sender's pubkey at send time)
// Decryption needs the recipient's privkey + the sender's pubkey from the row.

import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

export const MESSAGING_KEY_DERIVATION_MESSAGE =
  "Firmus Novus messaging key v1\n\nSign this once to enable end-to-end encrypted messaging on Firmus Novus. Your private key never leaves your browser.";

export interface MessagingKeypair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 32 bytes
}

/**
 * Derive a deterministic X25519 keypair from a wallet signature. We hash the
 * sig with SHA-512 then take the first 32 bytes as the seed — same shape
 * tweetnacl's `box.keyPair.fromSecretKey` expects.
 */
export async function deriveMessagingKeypair(walletSignatureHex: string): Promise<MessagingKeypair> {
  // Strip 0x prefix if present.
  const hex = walletSignatureHex.startsWith("0x") ? walletSignatureHex.slice(2) : walletSignatureHex;
  const sigBytes = hexToBytes(hex);
  const seed = await sha256(sigBytes);
  const seed32 = seed.slice(0, 32);
  return nacl.box.keyPair.fromSecretKey(seed32);
}

export interface EncryptedPayload {
  ciphertextB64: string;
  nonceB64: string;
}

export function encryptMessage(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): EncryptedPayload {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = naclUtil.decodeUTF8(plaintext);
  const ciphertext = nacl.box(messageBytes, nonce, recipientPublicKey, senderSecretKey);
  return {
    ciphertextB64: naclUtil.encodeBase64(ciphertext),
    nonceB64: naclUtil.encodeBase64(nonce),
  };
}

/**
 * Decrypts a message. Returns null if the ciphertext doesn't authenticate —
 * which can happen if the sender's pubkey is wrong, or our privkey is wrong,
 * or the message was tampered with.
 */
export function decryptMessage(
  ciphertextB64: string,
  nonceB64: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): string | null {
  const ciphertext = naclUtil.decodeBase64(ciphertextB64);
  const nonce = naclUtil.decodeBase64(nonceB64);
  const plain = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey);
  if (!plain) return null;
  return naclUtil.encodeUTF8(plain);
}

// ---- helpers ----------------------------------------------------------

export function publicKeyToBase64(key: Uint8Array): string {
  return naclUtil.encodeBase64(key);
}
export function publicKeyFromBase64(b64: string): Uint8Array {
  return naclUtil.decodeBase64(b64);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex string has odd length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Browser-friendly: works in Edge runtime + Node 18+. We pass the
  // backing ArrayBuffer because TS's BufferSource type is finicky about
  // Uint8Array<ArrayBufferLike> in the latest lib.dom.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}
