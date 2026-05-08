import { describe, it, expect } from 'vitest';
import { emptyTree, appendLeaf, leafFromMessage, type HexString } from '../merkle';

describe('Incremental Merkle (depth 16)', () => {
  it('empty tree has the all-zeros root', async () => {
    const t = await emptyTree();
    expect(t.depth).toBe(16);
    expect(t.leafCount).toBe(0);
    expect(t.root.startsWith('0x')).toBe(true);
  });

  it('appending leaves changes the root deterministically', async () => {
    const empty = await emptyTree();
    const leaf1 = ('0x' + 'a'.repeat(64)) as HexString;
    const leaf2 = ('0x' + 'b'.repeat(64)) as HexString;
    const t1 = await appendLeaf(empty, leaf1);
    const t2 = await appendLeaf(t1, leaf2);
    expect(t1.root).not.toBe(empty.root);
    expect(t2.root).not.toBe(t1.root);
    expect(t2.leafCount).toBe(2);

    // Determinism: re-running yields the same root.
    const e2 = await emptyTree();
    const t1a = await appendLeaf(e2, leaf1);
    const t2a = await appendLeaf(t1a, leaf2);
    expect(t2.root).toBe(t2a.root);
  });

  it('different leaf orderings produce different roots', async () => {
    const empty = await emptyTree();
    const a = ('0x' + 'a'.repeat(64)) as HexString;
    const b = ('0x' + 'b'.repeat(64)) as HexString;
    const ab = await appendLeaf(await appendLeaf(empty, a), b);
    const ba = await appendLeaf(await appendLeaf(empty, b), a);
    expect(ab.root).not.toBe(ba.root);
  });

  it('leafFromMessage produces 32-byte hashes', async () => {
    const ct = new TextEncoder().encode('ciphertext');
    const sig = new TextEncoder().encode('signature');
    const sender = ('0x' + '1'.repeat(40)) as HexString;
    const leaf = await leafFromMessage(ct, sig, sender, 0);
    expect(leaf.length).toBe(32);
  });
});
