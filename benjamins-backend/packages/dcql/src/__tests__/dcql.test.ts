import { describe, expect, it } from "vitest";
import { buildBarDcql, buildPidDcql, pickVpFromToken } from "../index";

describe("dcql", () => {
  it("buildBarDcql includes only the disclosed-attribute subset", () => {
    const q = buildBarDcql();
    const claimPaths = q.credentials[0].claims.map((c) => c.path[0]);
    expect(claimPaths).toEqual([
      "given_name",
      "family_name",
      "jurisdiction",
      "bar_admission_date",
      "bar_admission_number",
      "valid_until",
    ]);
  });

  it("buildBarDcql does NOT request practice area", () => {
    const q = buildBarDcql();
    const flat = q.credentials[0].claims.flatMap((c) => c.path).join(",");
    expect(flat).not.toContain("practice_area");
    expect(flat).not.toContain("practiceArea");
  });

  it("buildPidDcql requests ONLY age_equal_or_over.18 and address.country (no PII)", () => {
    const q = buildPidDcql();
    const paths = q.credentials[0].claims.map((c) => c.path.join("."));
    expect(paths).toEqual(["age_equal_or_over.18", "address.country"]);
  });

  it("buildPidDcql does NOT request name, nationalities, birth_date, document_number, place_of_birth, or sex", () => {
    const q = buildPidDcql();
    const flat = q.credentials[0].claims.flatMap((c) => c.path).join(",");
    expect(flat).not.toContain("given_name");
    expect(flat).not.toContain("family_name");
    expect(flat).not.toContain("nationalities");
    expect(flat).not.toContain("birth_date");
    expect(flat).not.toContain("document_number");
    expect(flat).not.toContain("place_of_birth");
    expect(flat).not.toContain("sex");
  });

  it("pickVpFromToken handles a stringified-object value (string variant)", () => {
    const tok = JSON.stringify({ "lawyer-cred": "eyJabc.def.ghi~Disclosure1~kb.jwt" });
    expect(pickVpFromToken(tok, "lawyer-cred")).toBe("eyJabc.def.ghi~Disclosure1~kb.jwt");
  });

  it("pickVpFromToken handles a stringified-object value (array variant)", () => {
    const tok = JSON.stringify({ "lawyer-cred": ["eyJabc.def.ghi~Disclosure1~kb.jwt"] });
    expect(pickVpFromToken(tok, "lawyer-cred")).toBe("eyJabc.def.ghi~Disclosure1~kb.jwt");
  });

  it("pickVpFromToken throws on missing credential id", () => {
    expect(() => pickVpFromToken(JSON.stringify({ other: "x" }), "missing")).toThrow();
  });
});
