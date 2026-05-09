"use client";

/**
 * F8 — Browser-only E2EE crypto package.
 *
 * Constitution invariant 1: this code path runs CLIENT-SIDE ONLY. The
 * browser holds the P-256 private half of every per-engagement keypair;
 * the server has no decryption capability.
 *
 * `scripts/check-no-server-decryption.sh` enforces that no file under
 * `app/api/**`, `lib/auth/**`, `lib/chain/**`, or `middleware.ts` imports
 * anything from `lib/crypto/*`. Any such import fails the build.
 */

/**
 * Throws a clear error when WebCrypto subtle is unavailable. Every other
 * module in `lib/crypto/*` calls this before touching `subtle.*` so
 * accidental server imports surface a useful message rather than a cryptic
 * "Cannot read properties of undefined" deep in the call stack.
 */
export function assertSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto subtle API is unavailable. lib/crypto/* is browser-only — " +
        "do not import it from server-side code.",
    );
  }
  return subtle;
}

export * from "./ecdh";
export * from "./aes-gcm";
export * from "./ecdsa";
export * from "./merkle";
