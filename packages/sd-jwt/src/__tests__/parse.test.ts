import { describe, expect, it } from "vitest";
import { decodeDisclosure, parseEnvelope, sha256B64 } from "../parse";

describe("sd-jwt parseEnvelope", () => {
  it("splits a JWS-only envelope (no disclosures, no KB-JWT)", () => {
    const e = parseEnvelope("aaa.bbb.ccc");
    expect(e.jws).toBe("aaa.bbb.ccc");
    expect(e.disclosures).toEqual([]);
    expect(e.kbJwt).toBeNull();
  });

  it("splits a JWS + disclosures + KB-JWT", () => {
    const e = parseEnvelope("aaa.bbb.ccc~ddd~eee~fff.ggg.hhh");
    expect(e.jws).toBe("aaa.bbb.ccc");
    expect(e.disclosures).toEqual(["ddd", "eee"]);
    expect(e.kbJwt).toBe("fff.ggg.hhh");
  });

  it("treats trailing tilde with no KB-JWT as no key binding", () => {
    const e = parseEnvelope("aaa.bbb.ccc~ddd~");
    expect(e.kbJwt).toBeNull();
    expect(e.disclosures).toEqual(["ddd"]);
  });
});

describe("sd-jwt decodeDisclosure", () => {
  it("decodes a 3-item object disclosure", () => {
    const b64 = btoa('["salt","given_name","Anna"]')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const arr = decodeDisclosure(b64);
    expect(arr).toEqual(["salt", "given_name", "Anna"]);
  });
});

describe("sd-jwt sha256B64", () => {
  it("matches the digest used in the wwWallet spike", async () => {
    const d = await sha256B64("test");
    expect(d).toBe("n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg");
  });
});
