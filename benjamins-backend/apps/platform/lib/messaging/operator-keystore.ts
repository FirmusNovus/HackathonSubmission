/**
 * Browser-side keystore for the operator's P-256 messaging keypair.
 *
 * Mirrors `keystore.ts` but global rather than per-engagement: there is
 * one operator-as-arbiter keypair per browser. The PRIVATE half lives in
 * IndexedDB and never leaves; the PUBLIC half is published once to
 * `/api/operator/messaging-key` so disputers can fetch it via
 * `/api/chain/config` and encrypt their bundles to the operator.
 *
 * Constitution Inv 1 (no platform-held decryption keys) is preserved by
 * this asymmetry — the platform stores only ciphertext + the disputer's
 * ephemeral pubkey, and only the operator's browser can decrypt by
 * combining its private key with the ephemeral pubkey.
 */
"use client";

import { generateP256Keypair, type JwkP256Private, type JwkP256Public } from "@lex-nova/crypto";

// Use a separate IndexedDB so we don't have to coordinate version bumps
// with the per-engagement keystore (which uses "lex-nova" v1).
const DB_NAME = "lex-nova-operator";
const STORE = "operator-keypair";
const DB_VERSION = 1;
const FIXED_KEY = "operator";

export interface StoredOperatorKeypair {
  publicJwk: JwkP256Public;
  privateJwk: JwkP256Private;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txGet<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOperatorKeypair(): Promise<StoredOperatorKeypair | null> {
  const v = await txGet<StoredOperatorKeypair | undefined>(STORE, "readonly", (s) =>
    s.get(FIXED_KEY)
  );
  return v ?? null;
}

export async function generateOperatorKeypair(): Promise<StoredOperatorKeypair> {
  const kp = await generateP256Keypair();
  await txGet(STORE, "readwrite", (s) => s.put(kp, FIXED_KEY));
  return kp;
}

export async function clearOperatorKeypair(): Promise<void> {
  await txGet(STORE, "readwrite", (s) => s.delete(FIXED_KEY));
}
