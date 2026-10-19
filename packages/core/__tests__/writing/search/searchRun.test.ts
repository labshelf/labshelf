// Pins the project search outcome over file texts: labelled results, an invalid query and matches by file.
import { posixPathOps } from "../../../src/library/index.js";
import { matchesIn, searchProjectTexts } from "../../../src/writing/search/index.js";

const project = { folder: "/lib/thesis", paths: posixPathOps };
const texts = [
  { path: "/lib/thesis/main.tex", text: "Hello world\nsay hello" },
  { path: "/lib/thesis/chapters/one.tex", text: "nothing here" },
];
const options = { matchCase: false, wholeWord: false, regex: false };

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

describe("matchesIn", () => {
  const pattern = /hello/gi;
  it("lists the matches of every file, or of one", () => {
    expect(matchesIn(texts, pattern)).toEqual([
      { path: "/lib/thesis/main.tex", line: 0, column: 0, length: 5 },
      { path: "/lib/thesis/main.tex", line: 1, column: 4, length: 5 },
    ]);
    expect(matchesIn(texts, pattern, "/lib/thesis/chapters/one.tex")).toEqual([]);
  });
});
