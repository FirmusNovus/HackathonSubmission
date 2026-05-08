// Incremental Merkle tree (depth 16) with SHA-256 leaves. Universal (browser + Node).
// Owner spec: 001-verified-legal-engagement.

const TREE_DEPTH = 16;

export type HexString = `0x${string}`;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  }
  // Node fallback for tests outside the browser bundle.
  const { createHash } = await import('node:crypto');
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function toHex(bytes: Uint8Array): HexString {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s as HexString;
}

function fromHex(hex: HexString | string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error('hex must have even length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hashPair(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  const buf = new Uint8Array(left.length + right.length);
  buf.set(left, 0);
  buf.set(right, left.length);
  return sha256(buf);
}

async function computeZeros(depth: number): Promise<Uint8Array[]> {
  const zeros: Uint8Array[] = [new Uint8Array(32)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(await hashPair(zeros[i - 1]!, zeros[i - 1]!));
  }
  return zeros;
}

export interface IncrementalMerkleState {
  depth: number;
  leafCount: number;
  root: HexString;
  filledSubtrees: HexString[];
}

export async function emptyTree(depth: number = TREE_DEPTH): Promise<IncrementalMerkleState> {
  const zeros = await computeZeros(depth);
  return {
    depth,
    leafCount: 0,
    root: toHex(zeros[depth]!),
    filledSubtrees: zeros.slice(0, depth).map(toHex),
  };
}

export async function appendLeaf(
  state: IncrementalMerkleState,
  leaf: HexString | Uint8Array,
): Promise<IncrementalMerkleState> {
  const leafBytes = leaf instanceof Uint8Array ? leaf : fromHex(leaf);
  if (leafBytes.length !== 32) throw new Error('leaf must be 32 bytes');

  const zeros = await computeZeros(state.depth);
  let current = leafBytes;
  let index = state.leafCount;
  const filledSubtrees = state.filledSubtrees.map(fromHex);

  for (let i = 0; i < state.depth; i++) {
    if ((index & 1) === 0) {
      filledSubtrees[i] = current;
      current = await hashPair(current, zeros[i]!);
    } else {
      current = await hashPair(filledSubtrees[i]!, current);
    }
    index >>= 1;
  }
  return {
    depth: state.depth,
    leafCount: state.leafCount + 1,
    root: toHex(current),
    filledSubtrees: filledSubtrees.map(toHex),
  };
}

export async function leafFromMessage(
  ciphertext: Uint8Array,
  signature: Uint8Array,
  sender: HexString,
  index: number,
): Promise<Uint8Array> {
  const senderBytes = fromHex(sender);
  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, BigInt(index));
  const buf = new Uint8Array(
    ciphertext.length + signature.length + senderBytes.length + indexBytes.length,
  );
  let off = 0;
  buf.set(ciphertext, off);
  off += ciphertext.length;
  buf.set(signature, off);
  off += signature.length;
  buf.set(senderBytes, off);
  off += senderBytes.length;
  buf.set(indexBytes, off);
  return sha256(buf);
}

export const TREE_DEFAULT_DEPTH = TREE_DEPTH;
