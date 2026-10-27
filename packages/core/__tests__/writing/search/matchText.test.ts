/** Verifies line-based match positions, CRLF handling, zero-length matches, and that one match is replaced only when it still matches at its position, with group references expanded. */
import { findInText, matchReplacement, searchPattern } from "../../../src/writing/search/index";

const re = (query: string, regex = false, wholeWord = false): RegExp => {
  const result = searchPattern(query, { matchCase: false, regex, wholeWord });
  if (!(result instanceof RegExp)) { throw new Error(result.error); }
  return result;
};

describe("findInText", () => {
  it("reports line, column and length of each match, several per line", () => {
    expect(findInText("ab ab\nxx\nab", re("ab"))).toEqual([
      { line: 0, column: 0, length: 2, lineText: "ab ab" },
      { line: 0, column: 3, length: 2, lineText: "ab ab" },
      { line: 2, column: 0, length: 2, lineText: "ab" },
    ]);
  });

  it("splits on CRLF without leaving the carriage return in the line text", () => {
    expect(findInText("one\r\ntwo\r\n", re("two"))).toEqual([{ line: 1, column: 0, length: 3, lineText: "two" }]);
  });

  it("skips zero-length matches", () => {
    expect(findInText("abc\ndef", re("^", true))).toEqual([]);
    expect(findInText("axxb", re("x*", true))).toEqual([{ line: 0, column: 1, length: 2, lineText: "axxb" }]);
  });

  it("is repeatable with the same global pattern", () => {
    const pattern = re("a");
    expect(findInText("a", pattern)).toHaveLength(1);
    expect(findInText("a", pattern)).toHaveLength(1);
  });
});

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
