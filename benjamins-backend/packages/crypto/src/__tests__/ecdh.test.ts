import { describe, expect, it } from "vitest";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveSharedSecret,
  generateP256Keypair,
  hkdf,
  randomBytes,
} from "../ecdh";

describe("ecdh", () => {
  it("ECDH yields the same shared secret on both sides", async () => {
    const a = await generateP256Keypair();
    const b = await generateP256Keypair();
    const ab = await deriveSharedSecret(a.privateJwk, b.publicJwk);
    const ba = await deriveSharedSecret(b.privateJwk, a.publicJwk);
    expect(Array.from(ab)).toEqual(Array.from(ba));
  });

  it("HKDF is deterministic for the same (secret, salt, info, length)", async () => {
    const secret = new Uint8Array(32).fill(7);
    const salt = new TextEncoder().encode("salt-1");
    const info = new TextEncoder().encode("info-1");
    const k1 = await hkdf(secret, salt, info, 32);
    const k2 = await hkdf(secret, salt, info, 32);
    expect(Array.from(k1)).toEqual(Array.from(k2));
  });

  it("HKDF differs when info differs", async () => {
    const secret = new Uint8Array(32).fill(7);
    const salt = new TextEncoder().encode("s");
    const k1 = await hkdf(secret, salt, new TextEncoder().encode("a"), 32);
    const k2 = await hkdf(secret, salt, new TextEncoder().encode("b"), 32);
    expect(Array.from(k1)).not.toEqual(Array.from(k2));
  });

  it("AES-GCM round-trips with AAD", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const aad = new TextEncoder().encode("engagement:42|sender:0xabc");
    const plaintext = new TextEncoder().encode("Hello Anna, this is Marta.");
    const ct = await aesGcmEncrypt(key, iv, plaintext, aad);
    const pt = await aesGcmDecrypt(key, iv, ct, aad);
    expect(new TextDecoder().decode(pt)).toBe("Hello Anna, this is Marta.");
  });

  it("AES-GCM rejects tampered ciphertext", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const ct = await aesGcmEncrypt(key, iv, new Uint8Array([1, 2, 3]));
    ct[0] = ct[0] ^ 1; // flip a bit
    await expect(aesGcmDecrypt(key, iv, ct)).rejects.toThrow();
  });

  it("AES-GCM rejects mismatched AAD", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const ct = await aesGcmEncrypt(key, iv, new Uint8Array([1, 2, 3]), new TextEncoder().encode("a"));
    await expect(aesGcmDecrypt(key, iv, ct, new TextEncoder().encode("b"))).rejects.toThrow();
  });
});
