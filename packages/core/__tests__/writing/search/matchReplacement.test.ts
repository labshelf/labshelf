/** Verifies that one match is replaced only when it still matches at its position, with group references expanded. */
import { matchReplacement, searchPattern } from "../../../src/writing/search/index";

const re = (query: string, regex = false, wholeWord = false): RegExp => {
  const result = searchPattern(query, { matchCase: false, regex, wholeWord });
  if (!(result instanceof RegExp)) { throw new Error(result.error); }
  return result;
};

describe("matchReplacement", () => {
  it("returns the replacement for the match at the column", () => {
    expect(matchReplacement("a b a", re("a"), { column: 4, length: 1 }, "z")).toBe("z");
  });

  it("expands group references in regex mode", () => {
    expect(matchReplacement("fig 3, fig 4", re("fig (\\d)", true), { column: 7, length: 5 }, "Figure $1")).toBe("Figure 4");
    expect(matchReplacement("ab", re("(?<x>a)", true), { column: 0, length: 1 }, "[$<x>$&$$]")).toBe("[aa$]");
  });

  it("keeps an unknown group reference literal", () => {
    expect(matchReplacement("a", re("a"), { column: 0, length: 1 }, "$1")).toBe("$1");
  });

  it("respects whole-word boundaries around the column", () => {
    expect(matchReplacement("cat category", re("cat", false, true), { column: 4, length: 3 }, "dog")).toBeUndefined();
    expect(matchReplacement("cat category", re("cat", false, true), { column: 0, length: 3 }, "dog")).toBe("dog");
  });

  it("refuses a stale position whose text no longer matches", () => {
    expect(matchReplacement("a b a", re("a"), { column: 2, length: 1 }, "z")).toBeUndefined();
    expect(matchReplacement("aa", re("a+", true), { column: 0, length: 1 }, "z")).toBeUndefined();
  });

  it("does not move the caller's pattern", () => {
    const pattern = re("a");
    matchReplacement("a b a", pattern, { column: 4, length: 1 }, "z");
    expect(pattern.lastIndex).toBe(0);
  });
});
