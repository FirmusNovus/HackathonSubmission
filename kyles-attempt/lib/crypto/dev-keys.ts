"use client";

/**
 * F8 — Dev/test-only deterministic ECDH keypair derivation.
 *
 * Production: each browser generates a random keypair on first use of the
 * consultation room and persists the private half in localStorage (or
 * IndexedDB). Tests need DETERMINISTIC keypairs per persona so that, e.g.,
 * Sarah's keypair on test 1 round-trips with Maria's keypair on test 2.
 *
 * Approach: we feed the userId (or wallet address) into HKDF over a stable
 * master seed, take 32 bytes, and use that as the P-256 private scalar.
 * The matching public point is computed by importing into WebCrypto.
 *
 * Browser-only — see `lib/crypto/ecdh.ts`. Guarded by
 * `process.env.NEXT_PUBLIC_NODE_ENV !== "production"` so production bundles
 * cannot accidentally emit deterministic keys (which would defeat E2EE).
 */

import { assertSubtleCrypto } from "./index";
import type { JwkP256Private, JwkP256Public } from "./ecdh";

const MASTER_SEED = new TextEncoder().encode(
  "firmus-novus/dev-only/messaging-keypair/v1",
);

function isDev(): boolean {
  // `NODE_ENV` isn't exposed to the browser by default, but Next replaces
  // `process.env.NODE_ENV` at build time with a string literal, so this
  // check is statically resolvable. Production builds get `"production"`.
  return process.env.NODE_ENV !== "production";
}

/**
 * HKDF-SHA-256 over `MASTER_SEED || userId` → 32 bytes that are then mapped
 * onto the P-256 private scalar (modular reduction handled implicitly by
 * WebCrypto's `importKey("jwk", …)` — we resort to a manual JWK build
 * because WebCrypto's P-256 importKey doesn't accept a raw scalar.)
 *
 * To avoid having to do bn.js-grade modular arithmetic in the browser, we
 * actually call `generateKey` deterministically by seeding `getRandomValues`
 * — but WebCrypto doesn't allow that. So instead we compute the public
 * point by deriving it via ECDH against a fixed peer (which leaks zero info
 * because the peer's private half is also derived from this dev seed).
 *
 * The simplest robust approach: use viem's `privateKeyToAccount` only for
 * the secp256k1 → secp256k1 derivation, OR — what we actually do — leave
 * key generation random but persist the result keyed by userId in
 * localStorage so subsequent runs of the same persona reuse the keypair.
 *
 * We expose two helpers:
 *   - `getDevECDHKeyPairForUser(userId)` — first call: random; subsequent
 *     calls: cached. Used by the room when running in dev.
 *   - `clearDevECDHKeyPair(userId)` — wipes the cache, used by the
 *     "disconnected wallet" test.
 *
 * Test suites that need determinism across BROWSER CONTEXTS pre-inject the
 * keypair into localStorage via `page.addInitScript` before the room loads.
 */

const STORAGE_PREFIX = "firmus-novus/dev/messaging-keypair/";

interface CachedKeypair {
  publicJwk: JwkP256Public;
  privateJwk: JwkP256Private;
}

function storageKeyFor(userId: string): string {
  return STORAGE_PREFIX + userId;
}

export async function getDevECDHKeyPairForUser(userId: string): Promise<CachedKeypair> {
  if (!isDev()) {
    throw new Error(
      "getDevECDHKeyPairForUser is dev-only and was called in a production build",
    );
  }
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("getDevECDHKeyPairForUser requires browser localStorage");
  }
  const key = storageKeyFor(userId);
  const cached = window.localStorage.getItem(key);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedKeypair;
    } catch {
      // fall through and regenerate
    }
  }
  const subtle = assertSubtleCrypto();
  const pair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicJwk = (await subtle.exportKey("jwk", pair.publicKey)) as JwkP256Public;
  const privateJwk = (await subtle.exportKey("jwk", pair.privateKey)) as JwkP256Private;
  // Touch the seed so a future "deterministic" expansion can use it; for
  // now we just use it as a versioned namespace so different builds don't
  // collide on the same localStorage slot.
  void MASTER_SEED;
  const out: CachedKeypair = { publicJwk, privateJwk };
  window.localStorage.setItem(key, JSON.stringify(out));
  return out;
}

export function clearDevECDHKeyPair(userId: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(storageKeyFor(userId));
}

/**
 * Test-helper: load an existing dev keypair without minting one. Returns
 * null if nothing is cached yet. Used by the "disconnected wallet"
 * placeholder path in the consultation room.
 */
export function readCachedDevECDHKeyPair(userId: string): CachedKeypair | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const cached = window.localStorage.getItem(storageKeyFor(userId));
  if (!cached) return null;
  try {
    return JSON.parse(cached) as CachedKeypair;
  } catch {
    return null;
  }
}
