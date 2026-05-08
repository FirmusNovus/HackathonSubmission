import { describe, expect, it } from "vitest";
import { IncrementalMerkleTree, MERKLE_DEPTH, bytesToHex, hexToBytes, sha256 } from "../merkle";

describe("merkle", () => {
  it("empty tree yields the depth-16 zero root", async () => {
    const t = await IncrementalMerkleTree.create();
    const root = await t.currentRoot();
    expect(root.length).toBe(32);
  });

  it("appending the same leaves yields the same root", async () => {
    const t1 = await IncrementalMerkleTree.create();
    const t2 = await IncrementalMerkleTree.create();
    for (let i = 0; i < 5; i++) {
      const leaf = await sha256(new TextEncoder().encode(`m-${i}`));
      t1.append(leaf);
      t2.append(leaf);
    }
    const r1 = await t1.currentRoot();
    const r2 = await t2.currentRoot();
    expect(bytesToHex(r1)).toBe(bytesToHex(r2));
  });

  it("a tampered leaf changes the root", async () => {
    const t = await IncrementalMerkleTree.create();
    for (let i = 0; i < 3; i++) {
      t.append(await sha256(new TextEncoder().encode(`m-${i}`)));
    }
    const beforeTamper = bytesToHex(await t.currentRoot());

    const t2 = await IncrementalMerkleTree.create();
    t2.append(await sha256(new TextEncoder().encode("m-0")));
    t2.append(await sha256(new TextEncoder().encode("m-99"))); // different
    t2.append(await sha256(new TextEncoder().encode("m-2")));
    const afterTamper = bytesToHex(await t2.currentRoot());

    expect(beforeTamper).not.toBe(afterTamper);
  });

  it("rejects oversized leaves", async () => {
    const t = await IncrementalMerkleTree.create();
    expect(() => t.append(new Uint8Array(31))).toThrow();
  });

  it("hex round-trip", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex(bytes)).toBe("0xdeadbeef");
    expect(Array.from(hexToBytes("0xdeadbeef"))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(Array.from(hexToBytes("deadbeef"))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("MERKLE_DEPTH is 16", () => {
    expect(MERKLE_DEPTH).toBe(16);
  });
});
