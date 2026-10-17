/** Verifies line-based match positions, CRLF handling and zero-length matches. */
import { findInText, searchPattern } from "../../../src/writing/search/index";

const re = (query: string, regex = false): RegExp => {
  const result = searchPattern(query, { matchCase: false, regex, wholeWord: false });
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
