/**
 * Per-engagement E2EE primitives. ECDH P-256 → HKDF → AES-GCM.
 *
 * Constitution invariant 1: this code path MUST run client-side. The browser
 * holds the P-256 private key half; the server has no decryption capability.
 * The server may legitimately use AES-GCM-decrypt for its own short-lived
 * verifier-state encryption, but it never has any key derived from a wallet.
 */

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error("WebCrypto subtle API not available; this module requires a modern browser or Node 20+");
}

export interface JwkP256Public {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface JwkP256Private extends JwkP256Public {
  d: string;
}

export async function generateP256Keypair(): Promise<{ publicJwk: JwkP256Public; privateJwk: JwkP256Private }> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicJwk = (await subtle.exportKey("jwk", pair.publicKey)) as JwkP256Public;
  const privateJwk = (await subtle.exportKey("jwk", pair.privateKey)) as JwkP256Private;
  return { publicJwk, privateJwk };
}

export async function deriveSharedSecret(myPriv: JwkP256Private, theirPub: JwkP256Public): Promise<Uint8Array> {
  const priv = await subtle.importKey("jwk", myPriv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await subtle.importKey("jwk", theirPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return new Uint8Array(bits as ArrayBuffer);
}

export async function hkdf(
  secret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number
): Promise<Uint8Array> {
  const baseKey = await subtle.importKey("raw", secret as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    baseKey,
    lengthBytes * 8
  );
  return new Uint8Array(bits as ArrayBuffer);
}

function aesGcmParams(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  // Chrome's WebCrypto rejects an algo object that includes
  // `additionalData: undefined` ("AeadParams: additionalData: Not a BufferSource"),
  // so we omit the field entirely when no AAD is supplied.
  const params: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource };
  if (aad !== undefined) params.additionalData = aad as BufferSource;
  return params;
}

export async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== 32) throw new Error("AES-GCM expects a 32-byte key");
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ct = await subtle.encrypt(aesGcmParams(iv, aad), k, plaintext as BufferSource);
  return new Uint8Array(ct as ArrayBuffer);
}

export async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== 32) throw new Error("AES-GCM expects a 32-byte key");
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle.decrypt(aesGcmParams(iv, aad), k, ciphertext as BufferSource);
  return new Uint8Array(pt as ArrayBuffer);
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
