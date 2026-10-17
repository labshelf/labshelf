/** Verifies the query-to-RegExp conversion for case, regex and whole-word options. */
import { searchPattern } from "../../../src/writing/search/index";

const off = { matchCase: false, regex: false, wholeWord: false };

function pattern(query: string, options = off): RegExp {
  const result = searchPattern(query, options);
  if (!(result instanceof RegExp)) { throw new Error(`expected a pattern: ${result.error}`); }
  return result;
}

describe("searchPattern", () => {
  it("ignores case unless Match Case is on", () => {
    expect("Intro".match(pattern("intro"))).not.toBeNull();
    expect("Intro".match(pattern("intro", { ...off, matchCase: true }))).toBeNull();
  });

  it("matches the query literally unless regex is on", () => {
    expect("a.b axb".match(pattern("a.b"))).toEqual(["a.b"]);
    expect("a.b axb".match(pattern("a.b", { ...off, regex: true }))).toEqual(["a.b", "axb"]);
  });

  it("limits matches to whole words", () => {
    expect("cat concat cat.".match(pattern("cat", { ...off, wholeWord: true }))).toEqual(["cat", "cat"]);
  });

  it("wraps alternations as a group when matching whole words", () => {
    expect("a ab b".match(pattern("a|b", { matchCase: false, regex: true, wholeWord: true }))).toEqual(["a", "b"]);
  });

  it("reports an invalid regular expression", () => {
    const result = searchPattern("(", { ...off, regex: true });
    expect(result).not.toBeInstanceOf(RegExp);
    expect(result).toHaveProperty("error", expect.stringMatching(/\S/));
  });

  it("reports an empty query", () => {
    expect(searchPattern("", off)).toHaveProperty("error");
  });
});
