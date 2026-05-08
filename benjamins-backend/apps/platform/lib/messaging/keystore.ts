/**
 * Browser-side per-engagement keypair store (T061 / T062).
 *
 * Each party generates a P-256 ECDH keypair on engagement open and persists
 * it in the browser's IndexedDB. The PRIVATE half never leaves the browser
 * (Constitution invariant 1) — only the public half goes up to the platform
 * via /api/engagements/[requestId]/messaging-key.
 *
 * Storage shape:
 *   db: "lex-nova"
 *   store: "engagement-keypairs"
 *   key: requestId (number)
 *   value: { publicJwk, privateJwk } (both serialized)
 *
 * Note: this lives client-side only. Calling these functions from a server
 * component will throw because IndexedDB doesn't exist there.
 */
"use client";

import { generateP256Keypair, type JwkP256Private, type JwkP256Public } from "@lex-nova/crypto";

const DB_NAME = "lex-nova";
const STORE = "engagement-keypairs";
const DB_VERSION = 1;

export interface StoredKeypair {
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

async function txGet<T>(storeName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getKeypair(requestId: number): Promise<StoredKeypair | null> {
  const v = await txGet<StoredKeypair | undefined>(STORE, "readonly", (s) => s.get(requestId));
  return v ?? null;
}

export async function getOrCreateKeypair(requestId: number): Promise<StoredKeypair> {
  const existing = await getKeypair(requestId);
  if (existing) return existing;
  const kp = await generateP256Keypair();
  await txGet(STORE, "readwrite", (s) => s.put(kp, requestId));
  return kp;
}

export async function clearKeypair(requestId: number): Promise<void> {
  await txGet(STORE, "readwrite", (s) => s.delete(requestId));
}
