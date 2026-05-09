"use client";

/**
 * F8 — Per-engagement transcript Merkle tree (depth-16, SHA-256).
 *
 * Constitution invariant 5. F9 will use this for transcript-anchoring; we
 * ship the file with F8 so the message-send path can compute leaves
 * deterministically from day one.
 *
 * Leaf format (matches A's spec): `sha256(ciphertext || signature || sender || index)`.
 *   - ciphertext : raw bytes (post-AES-GCM, before base64 encode)
 *   - signature  : raw 65-byte r||s||v secp256k1 signature
 *   - sender     : raw 20-byte address (lowercased + hex-decoded)
 *   - index      : senderIndex as 4-byte big-endian uint32
 *
 * Order-dependent: swapping leaves 1 and 2 yields a different root.
 *
 * Browser-only — see `lib/crypto/ecdh.ts`.
 */

import { assertSubtleCrypto } from "./index";

export const MERKLE_DEPTH = 16;
const MAX_LEAVES = 1 << MERKLE_DEPTH; // 65 536

export interface MerkleTreeState {
  leaves: Uint8Array[];
  zeros: Uint8Array[];
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = assertSubtleCrypto();
  const buf = await subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(buf as ArrayBuffer);
}

async function hashPair(a: Uint8Array, b: Uint8Array): Promise<Uint8Array> {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return sha256(c);
}

async function buildZeroSubtrees(depth: number): Promise<Uint8Array[]> {
  const zeros: Uint8Array[] = [new Uint8Array(32)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(await hashPair(zeros[i - 1], zeros[i - 1]));
  }
  return zeros;
}

export async function createTree(): Promise<MerkleTreeState> {
  return { leaves: [], zeros: await buildZeroSubtrees(MERKLE_DEPTH) };
}

/** Append a 32-byte leaf hash. Mutates `tree` in place; returns the new index. */
export function appendLeaf(tree: MerkleTreeState, leafBytes: Uint8Array): number {
  if (leafBytes.length !== 32) {
    throw new Error(`leaf must be 32 bytes; got ${leafBytes.length}`);
  }
  if (tree.leaves.length >= MAX_LEAVES) {
    throw new Error(`tree full (${MAX_LEAVES} leaves)`);
  }
  tree.leaves.push(leafBytes);
  return tree.leaves.length - 1;
}

/** Compute the current root from the live leaf list. */
export async function currentRoot(tree: MerkleTreeState): Promise<Uint8Array> {
  if (tree.zeros.length !== MERKLE_DEPTH + 1) {
    throw new Error(`expected ${MERKLE_DEPTH + 1} zero subtrees`);
  }
  if (tree.leaves.length === 0) return tree.zeros[MERKLE_DEPTH];
  let layer: Uint8Array[] = tree.leaves.slice();
  for (let level = 0; level < MERKLE_DEPTH; level++) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : tree.zeros[level];
      next.push(await hashPair(left, right));
    }
    layer = next;
  }
  return layer[0];
}

/** Recompute the root over a list of leaves in order, from scratch. */
export async function recomputeRoot(allLeavesInOrder: Uint8Array[]): Promise<Uint8Array> {
  const tree = await createTree();
  for (const leaf of allLeavesInOrder) appendLeaf(tree, leaf);
  return currentRoot(tree);
}

/**
 * Build the canonical leaf for a message envelope.
 *
 * `sha256(ciphertext || signature || sender || index)`.
 *   - `ciphertext` : raw bytes (already AES-GCM-encrypted, NOT base64).
 *   - `signature`  : 65-byte r||s||v hex (with or without `0x` prefix).
 *   - `sender`     : 20-byte hex address (with or without `0x` prefix).
 *   - `index`      : non-negative integer; encoded as 4-byte big-endian uint32.
 */
export async function leafForMessage(args: {
  ciphertext: Uint8Array;
  signature: string;
  sender: string;
  index: number;
}): Promise<Uint8Array> {
  if (!Number.isInteger(args.index) || args.index < 0) {
    throw new Error(`bad sender index ${args.index}`);
  }
  const sigBytes = hexToBytes(args.signature);
  const senderBytes = hexToBytes(args.sender);
  if (senderBytes.length !== 20) {
    throw new Error(`sender must be a 20-byte address; got ${senderBytes.length}`);
  }
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, args.index, false);
  const buf = new Uint8Array(args.ciphertext.length + sigBytes.length + senderBytes.length + 4);
  let off = 0;
  buf.set(args.ciphertext, off);
  off += args.ciphertext.length;
  buf.set(sigBytes, off);
  off += sigBytes.length;
  buf.set(senderBytes, off);
  off += senderBytes.length;
  buf.set(idx, off);
  return sha256(buf);
}

// ===== hex helpers =====

export function bytesToHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}
