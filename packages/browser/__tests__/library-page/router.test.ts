import { folderFromHash, hashForFolder } from "../../src/library-page/router";

describe("router hash <-> folder", () => {
  it("round-trips folders, encoding each segment", () => {
    for (const f of ["papers", "papers/A", "papers/Reading group/Refs & notes"]) {
      expect(folderFromHash(hashForFolder(f))).toBe(f);
    }
    expect(hashForFolder("papers/Reading group")).toBe("#/papers/Reading%20group");
  });
  it("falls back to the root for empty, foreign or traversal hashes", () => {
    for (const h of ["", "#", "#/", "#/elsewhere", "#/papers-old/x", "#/papers/../x", "#/papers//x", "#/papers/./x", "#/papers/a%5Cb"]) {
      expect(folderFromHash(h)).toBe("papers");
    }
  });
  it("tolerates a trailing slash", () => {
    expect(folderFromHash("#/papers/A/")).toBe("papers/A");
  });
});
