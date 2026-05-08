// ECDSA P-256 sign/verify via WebCrypto. Browser-only.
// Owner spec: 001-verified-legal-engagement.

import type { JwkPrivateKey, JwkPublicKey } from './ecdh';

export async function generateEcdsaKeyPair(): Promise<{
  publicJwk: JwkPublicKey;
  privateJwk: JwkPrivateKey;
}> {
  const subtle = getSubtle();
  const kp = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  return {
    publicJwk: (await subtle.exportKey('jwk', kp.publicKey)) as JwkPublicKey,
    privateJwk: (await subtle.exportKey('jwk', kp.privateKey)) as JwkPrivateKey,
  };
}

export async function signEcdsa(
  privateJwk: JwkPrivateKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data as BufferSource);
  return new Uint8Array(sig);
}

export async function verifyEcdsa(
  publicJwk: JwkPublicKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, data as BufferSource);
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto not available — this code path is browser-only');
  }
  return globalThis.crypto.subtle;
}
