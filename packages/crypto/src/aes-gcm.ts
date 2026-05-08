// AES-GCM-256 encrypt/decrypt with HKDF-SHA-256 key derivation. Browser-only.
// Owner spec: 001-verified-legal-engagement.

export interface EncryptedEnvelope {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
}

const HKDF_INFO = new TextEncoder().encode('firmus-novus.message.aes-gcm.v1');

export async function deriveAesKey(
  sharedSecret: ArrayBuffer,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptMessage(
  sharedSecret: ArrayBuffer,
  plaintext: Uint8Array,
): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(sharedSecret, salt);
  const ciphertext = new Uint8Array(
    await getSubtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  return { ciphertext, iv, salt };
}

export async function decryptMessage(
  sharedSecret: ArrayBuffer,
  envelope: EncryptedEnvelope,
): Promise<Uint8Array> {
  const key = await deriveAesKey(sharedSecret, envelope.salt);
  const plaintext = await getSubtle().decrypt(
    { name: 'AES-GCM', iv: envelope.iv },
    key,
    envelope.ciphertext,
  );
  return new Uint8Array(plaintext);
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto not available — this code path is browser-only');
  }
  return globalThis.crypto.subtle;
}
