/** Verifies that template paths sort by UTF-16 code unit, never by locale. */
import { comparePaths } from "../../../src/templates/templateManifest/index";

describe("comparePaths", () => {
  it("puts uppercase before lowercase", () => {
    expect(comparePaths("B", "a")).toBeLessThan(0);
  });

  it("puts a dash before a slash", () => {
    expect(comparePaths("a-b", "a/b")).toBeLessThan(0);
  });

  it("puts a non-ASCII letter after z", () => {
    expect(comparePaths("é", "z")).toBeGreaterThan(0);
  });

  it("returns 0 for equal strings", () => {
    expect(comparePaths("a/x", "a/x")).toBe(0);
  });

  it("sorts a list in code-unit order", () => {
    expect(["b/x", "B/x", "a.tex", "a/x"].sort(comparePaths)).toEqual(["B/x", "a.tex", "a/x", "b/x"]);
  });
});
