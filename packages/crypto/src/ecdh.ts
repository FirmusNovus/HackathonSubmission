// ECDH P-256 helpers via WebCrypto. Browser-only.
// Owner spec: 001-verified-legal-engagement.

export interface JwkPublicKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}

export interface JwkPrivateKey extends JwkPublicKey {
  d: string;
}

export async function generateEcdhKeyPair(): Promise<{
  publicJwk: JwkPublicKey;
  privateJwk: JwkPrivateKey;
}> {
  const subtle = getSubtle();
  const kp = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicJwk = (await subtle.exportKey('jwk', kp.publicKey)) as JwkPublicKey;
  const privateJwk = (await subtle.exportKey('jwk', kp.privateKey)) as JwkPrivateKey;
  return { publicJwk, privateJwk };
}

export async function deriveSharedSecret(
  ownPrivateJwk: JwkPrivateKey,
  peerPublicJwk: JwkPublicKey,
): Promise<ArrayBuffer> {
  const subtle = getSubtle();
  const ownKey = await subtle.importKey(
    'jwk',
    ownPrivateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const peerKey = await subtle.importKey(
    'jwk',
    peerPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  return await subtle.deriveBits({ name: 'ECDH', public: peerKey }, ownKey, 256);
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto not available — this code path is browser-only');
  }
  return globalThis.crypto.subtle;
}
