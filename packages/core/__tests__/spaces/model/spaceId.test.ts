/** Verifies the space id slug rule: ASCII folding, separators, the empty fallback, the 48-character cap and collision suffixes. */
import { spaceIdFromName } from "../../../src/spaces/model/index";

const none = new Set<string>();

describe("spaceIdFromName", () => {
  it("folds accents, lowercases and joins other runs with one dash", () => {
    expect(spaceIdFromName("Élan  Vital: Ça marche!", none)).toBe("elan-vital-ca-marche");
    expect(spaceIdFromName("--Research__internship 2026--", none)).toBe("research-internship-2026");
  });

  it("gives space for a name with no ASCII letters or digits", () => {
    expect(spaceIdFromName("", none)).toBe("space");
    expect(spaceIdFromName("研究 !!", none)).toBe("space");
  });

  it("caps the id at 48 characters without a trailing dash", () => {
    const id = spaceIdFromName(`${"a".repeat(47)} bcd`, none);
    expect(id).toBe("a".repeat(47));
    expect(spaceIdFromName("x".repeat(60), none)).toHaveLength(48);
  });

  it("adds -2, -3 on collision and keeps the suffixed id within 48 characters", () => {
    expect(spaceIdFromName("Thesis", new Set(["thesis"]))).toBe("thesis-2");
    expect(spaceIdFromName("Thesis", new Set(["thesis", "thesis-2"]))).toBe("thesis-3");
    const long = "y".repeat(48);
    const id = spaceIdFromName(long, new Set([long]));
    expect(id).toBe(`${"y".repeat(46)}-2`);
    expect(spaceIdFromName("", new Set(["space"]))).toBe("space-2");
  });
});
