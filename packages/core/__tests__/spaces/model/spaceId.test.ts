/** Verifies the space id slug rule: ASCII folding, separators, the empty fallback, the 48-character cap and collision suffixes. */
import { deriveSpaceId } from "../../../src/spaces/model/index";

const none = new Set<string>();

describe("deriveSpaceId", () => {
  it("folds accents, lowercases and joins other runs with one dash", () => {
    expect(deriveSpaceId("Élan  Vital: Ça marche!", none)).toBe("elan-vital-ca-marche");
    expect(deriveSpaceId("--Research__internship 2026--", none)).toBe("research-internship-2026");
  });

  it("gives space for a name with no ASCII letters or digits", () => {
    expect(deriveSpaceId("", none)).toBe("space");
    expect(deriveSpaceId("研究 !!", none)).toBe("space");
  });

  it("caps the id at 48 characters without a trailing dash", () => {
    const id = deriveSpaceId(`${"a".repeat(47)} bcd`, none);
    expect(id).toBe("a".repeat(47));
    expect(deriveSpaceId("x".repeat(60), none)).toHaveLength(48);
  });

  it("adds -2, -3 on collision and keeps the suffixed id within 48 characters", () => {
    expect(deriveSpaceId("Thesis", new Set(["thesis"]))).toBe("thesis-2");
    expect(deriveSpaceId("Thesis", new Set(["thesis", "thesis-2"]))).toBe("thesis-3");
    const long = "y".repeat(48);
    const id = deriveSpaceId(long, new Set([long]));
    expect(id).toBe(`${"y".repeat(46)}-2`);
    expect(deriveSpaceId("", new Set(["space"]))).toBe("space-2");
  });
});
