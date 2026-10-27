// Pins the project search outcome over file texts: labelled results, an invalid query, matches by file, grouping, the result cap and clipped previews.
import { posixPathOps } from "../../../src/path/index";
import { deriveSearchMatches, findMatchesIn, searchPattern, searchProjectTexts } from "../../../src/writing/search/index.js";

const project = { folder: "/lib/thesis", paths: posixPathOps };
const texts = [
  { path: "/lib/thesis/main.tex", text: "Hello world\nsay hello" },
  { path: "/lib/thesis/chapters/one.tex", text: "nothing here" },
];
const options = { matchCase: false, wholeWord: false, regex: false };

const re = (query: string): RegExp => {
  const result = searchPattern(query, options);
  if (!(result instanceof RegExp)) { throw new Error(result.error); }
  return result;
};

describe("searchProjectTexts", () => {
  it("labels results with the path inside the project and lists the searched files", () => {
    const run = searchProjectTexts("hello", options, project, texts);
    expect(run.message).toMatchObject({ type: "results", results: { total: 2, files: [{ label: "main.tex" }] } });
    expect([...run.paths]).toEqual(["/lib/thesis/main.tex", "/lib/thesis/chapters/one.tex"]);
    expect(run.pattern).toBeInstanceOf(RegExp);
  });

  it("names an unsearchable query without a pattern", () => {
    const run = searchProjectTexts("(", { ...options, regex: true }, project, texts);
    expect(run.message.type).toBe("invalid");
    expect(run.pattern).toBeUndefined();
  });
});

describe("findMatchesIn", () => {
  const pattern = /hello/gi;
  it("lists the matches of every file, or of one", () => {
    expect(findMatchesIn(texts, pattern)).toEqual([
      { path: "/lib/thesis/main.tex", line: 0, column: 0, length: 5 },
      { path: "/lib/thesis/main.tex", line: 1, column: 4, length: 5 },
    ]);
    expect(findMatchesIn(texts, pattern, "/lib/thesis/chapters/one.tex")).toEqual([]);
  });
});

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
