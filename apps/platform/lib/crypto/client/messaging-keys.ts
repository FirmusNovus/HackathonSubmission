// Owner spec: 001-verified-legal-engagement.
// Browser-only. Persists per-engagement ECDH keypair to localStorage keyed
// by (address, engagementId). Constitution Inv 1: this module MUST NOT be
// imported from any server code path.

import { generateEcdhKeyPair, deriveSharedSecret, type JwkPrivateKey, type JwkPublicKey } from '@firmus-novus/crypto';

const STORAGE_PREFIX = 'fn:msg:keypair';

export interface StoredKeyPair {
  privateJwk: JwkPrivateKey;
  publicJwk: JwkPublicKey;
}

function storageKey(address: string, engagementId: number): string {
  return `${STORAGE_PREFIX}:${address.toLowerCase()}:${engagementId}`;
}

export async function ensureKeyPair(
  address: string,
  engagementId: number,
): Promise<StoredKeyPair> {
  const key = storageKey(address, engagementId);
  const existing = window.localStorage.getItem(key);
  if (existing) return JSON.parse(existing) as StoredKeyPair;
  const generated = await generateEcdhKeyPair();
  window.localStorage.setItem(key, JSON.stringify(generated));
  return generated;
}

export function getStoredKeyPair(address: string, engagementId: number): StoredKeyPair | null {
  const v = window.localStorage.getItem(storageKey(address, engagementId));
  return v ? (JSON.parse(v) as StoredKeyPair) : null;
}

export { deriveSharedSecret };
