/**
 * Per-engagement transcript Merkle tree. Constitution invariant 5.
 *
 * Depth 16 → 65 536 leaves per engagement, comfortably more than any
 * realistic chat history. SHA-256 leaf hashing (cheap, browser-native).
 * Empty subtree filled with zero leaves so every internal node has a defined
 * value even before all 65 536 slots are appended.
 */

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error("WebCrypto subtle API not available");
}

export const MERKLE_DEPTH = 16;
const MAX_LEAVES = 1 << MERKLE_DEPTH;

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(buf as ArrayBuffer);
}

export async function hashPair(a: Uint8Array, b: Uint8Array): Promise<Uint8Array> {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return sha256(c);
}

export async function buildZeroSubtrees(depth: number): Promise<Uint8Array[]> {
  const zeros: Uint8Array[] = [new Uint8Array(32)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(await hashPair(zeros[i - 1], zeros[i - 1]));
  }
  return zeros;
}

export class IncrementalMerkleTree {
  private leaves: Uint8Array[] = [];
  private zeros: Uint8Array[];

  constructor(zeros: Uint8Array[]) {
    if (zeros.length !== MERKLE_DEPTH + 1) {
      throw new Error(`expected ${MERKLE_DEPTH + 1} zero subtrees`);
    }
    this.zeros = zeros;
  }

  static async create(): Promise<IncrementalMerkleTree> {
    return new IncrementalMerkleTree(await buildZeroSubtrees(MERKLE_DEPTH));
  }

  size(): number {
    return this.leaves.length;
  }

  append(leaf: Uint8Array): number {
    if (leaf.length !== 32) throw new Error("leaf must be 32 bytes");
    if (this.leaves.length >= MAX_LEAVES) throw new Error("tree full");
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  async currentRoot(): Promise<Uint8Array> {
    let layer: Uint8Array[] = this.leaves.slice();
    if (layer.length === 0) return this.zeros[MERKLE_DEPTH];
    for (let level = 0; level < MERKLE_DEPTH; level++) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = i + 1 < layer.length ? layer[i + 1] : this.zeros[level];
        next.push(await hashPair(left, right));
      }
      layer = next;
    }
    return layer[0];
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}
