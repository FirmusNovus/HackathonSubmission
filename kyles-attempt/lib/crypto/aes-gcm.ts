"use client";

/**
 * F8 — Authenticated encryption: AES-GCM-256 over an HKDF-SHA-256-derived key.
 *
 * `encrypt(plaintext, sharedSecret)`:
 *   - generates a fresh 16-byte salt and 12-byte IV per message
 *   - HKDF(sharedSecret, salt) → AES-256 key
 *   - AES-GCM encrypt → ciphertext + 16-byte auth tag (concatenated)
 *   - base64url encodes ciphertext, iv, salt
 *
 * `decrypt(envelope, sharedSecret)` reverses; AES-GCM tag verification
 * throws on tamper / wrong key.
 *
 * Browser-only — see `lib/crypto/ecdh.ts`.
 */

import { assertSubtleCrypto } from "./index";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const HKDF_INFO = new TextEncoder().encode("firmus-novus/messaging/aes-gcm-256");

export interface MessageEnvelope {
  /** base64url ciphertext (includes 16-byte AES-GCM auth tag at the tail). */
  ciphertext: string;
  /** base64url 12-byte AES-GCM IV. */
  iv: string;
  /** base64url 16-byte HKDF salt. */
  salt: string;
}

async function hkdfDeriveKey(
  sharedSecret: ArrayBuffer | Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const subtle = assertSubtleCrypto();
  const secretBytes =
    sharedSecret instanceof Uint8Array ? sharedSecret : new Uint8Array(sharedSecret);
  const baseKey = await subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: HKDF_INFO as BufferSource,
    },
    baseKey,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits as ArrayBuffer);
}

export async function encrypt(
  plaintext: string,
  sharedSecret: ArrayBuffer | Uint8Array,
): Promise<MessageEnvelope> {
  const subtle = assertSubtleCrypto();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const aesKey = await hkdfDeriveKey(sharedSecret, salt);
  const k = await subtle.importKey(
    "raw",
    aesKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    k,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ct as ArrayBuffer)),
    iv: bytesToBase64Url(iv),
    salt: bytesToBase64Url(salt),
  };
}

export async function decrypt(
  envelope: MessageEnvelope,
  sharedSecret: ArrayBuffer | Uint8Array,
): Promise<string> {
  const subtle = assertSubtleCrypto();
  const ct = base64UrlToBytes(envelope.ciphertext);
  const iv = base64UrlToBytes(envelope.iv);
  const salt = base64UrlToBytes(envelope.salt);
  if (iv.length !== IV_BYTES) throw new Error(`bad iv length ${iv.length}`);
  if (salt.length !== SALT_BYTES) throw new Error(`bad salt length ${salt.length}`);
  const aesKey = await hkdfDeriveKey(sharedSecret, salt);
  const k = await subtle.importKey(
    "raw",
    aesKey as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  // AES-GCM decrypt throws OperationError on tag-verification failure
  // (tampered ct, wrong key, wrong iv, wrong salt).
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    k,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt as ArrayBuffer);
}

// ===== base64url helpers =====

export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("WebCrypto getRandomValues unavailable");
  }
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
