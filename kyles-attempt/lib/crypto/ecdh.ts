"use client";

/**
 * F8 — Per-engagement E2EE primitives. ECDH P-256 key agreement.
 *
 * Browser-only: every export checks `globalThis.crypto.subtle` and throws
 * a clear error if WebCrypto is unavailable. This module MUST NOT be
 * imported from server-side code (`app/api/**`, `lib/auth/**`,
 * `lib/chain/**`, `middleware.ts`) — `scripts/check-no-server-decryption.sh`
 * fails the build if a violation is detected.
 *
 * Ported from `smart-contracts-ideation/packages/crypto/src/ecdh.ts`.
 */

import { assertSubtleCrypto } from "./index";

export interface JwkP256Public {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}

export interface JwkP256Private extends JwkP256Public {
  d: string;
}

export async function generateP256Keypair(): Promise<{
  publicJwk: JwkP256Public;
  privateJwk: JwkP256Private;
}> {
  const subtle = assertSubtleCrypto();
  const pair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicJwk = (await subtle.exportKey("jwk", pair.publicKey)) as JwkP256Public;
  const privateJwk = (await subtle.exportKey("jwk", pair.privateKey)) as JwkP256Private;
  return { publicJwk, privateJwk };
}

/**
 * ECDH key agreement. Both sides feed `(myPriv, theirPub)` and arrive at
 * the same 32-byte shared secret. The first 32 bytes (`.slice(0, 32)`)
 * are returned; HKDF in `aes-gcm.ts` then derives the AES-256 key.
 */
export async function deriveSharedSecret(
  myPriv: JwkP256Private,
  theirPub: JwkP256Public,
): Promise<Uint8Array> {
  const subtle = assertSubtleCrypto();
  const priv = await subtle.importKey(
    "jwk",
    myPriv,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const pub = await subtle.importKey(
    "jwk",
    theirPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return new Uint8Array(bits as ArrayBuffer).slice(0, 32);
}

// ----- JWK serialization helpers -----

export function publicJwkToJson(jwk: JwkP256Public): string {
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
}

export function privateJwkToJson(jwk: JwkP256Private): string {
  return JSON.stringify({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
  });
}

export function publicJwkFromJson(s: string): JwkP256Public {
  const o = JSON.parse(s) as Partial<JwkP256Public>;
  if (o.kty !== "EC" || o.crv !== "P-256" || typeof o.x !== "string" || typeof o.y !== "string") {
    throw new Error("invalid P-256 public JWK");
  }
  return { kty: "EC", crv: "P-256", x: o.x, y: o.y };
}

export function privateJwkFromJson(s: string): JwkP256Private {
  const o = JSON.parse(s) as Partial<JwkP256Private>;
  if (
    o.kty !== "EC" ||
    o.crv !== "P-256" ||
    typeof o.x !== "string" ||
    typeof o.y !== "string" ||
    typeof o.d !== "string"
  ) {
    throw new Error("invalid P-256 private JWK");
  }
  return { kty: "EC", crv: "P-256", x: o.x, y: o.y, d: o.d };
}

/** Crypto-strong random bytes — wraps `globalThis.crypto.getRandomValues`. */
export function randomBytes(n: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "WebCrypto getRandomValues unavailable; lib/crypto/* requires a browser context",
    );
  }
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
