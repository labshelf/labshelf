/** Verifies grouping matches by file, the result cap and the clipped line previews. */
import { deriveSearchMatches, searchPattern } from "../../../src/writing/search/index";

const re = (query: string): RegExp => {
  const result = searchPattern(query, { matchCase: false, regex: false, wholeWord: false });
  if (!(result instanceof RegExp)) { throw new Error(result.error); }
  return result;
};

describe("deriveSearchMatches", () => {
  it("groups matches by file and skips files without any", () => {
    const results = deriveSearchMatches([
      { path: "/p/a.tex", label: "a.tex", text: "foo\nbar foo" },
      { path: "/p/b.tex", label: "b.tex", text: "nothing" },
      { path: "/p/c.bib", label: "c.bib", text: "Foo" },
    ], re("foo"), 100);
    expect(results.total).toBe(3);
    expect(results.truncated).toBe(false);
    expect(results.files.map((f) => [f.label, f.matches.length])).toEqual([["a.tex", 2], ["c.bib", 1]]);
    expect(results.files[0]?.matches[1]).toEqual({ line: 1, column: 4, length: 3, before: "bar ", text: "foo", after: "" });
  });

  it("stops at the limit and says so", () => {
    const results = deriveSearchMatches([
      { path: "/p/a.tex", label: "a.tex", text: "x x x" },
      { path: "/p/b.tex", label: "b.tex", text: "x" },
    ], re("x"), 2);
    expect(results.total).toBe(2);
    expect(results.truncated).toBe(true);
    expect(results.files).toHaveLength(1);
  });

  it("clips long context on both sides of the match", () => {
    const line = `${"a".repeat(200)}needle${"b".repeat(400)}`;
    const [match] = deriveSearchMatches([{ path: "/p/a.tex", label: "a.tex", text: line }], re("needle"), 10).files[0]?.matches ?? [];
    expect(match?.column).toBe(200);
    expect(match?.before.startsWith("…")).toBe(true);
    expect(match?.before.length).toBeLessThan(60);
    expect(match?.after.length).toBeLessThan(200);
    expect(match?.text).toBe("needle");
  });
});
