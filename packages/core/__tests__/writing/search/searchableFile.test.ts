/** Verifies which project files Search in Project reads. */
import { isSearchableFile } from "../../../src/writing/search/index";

describe("isSearchableFile", () => {
  it.each(["a/main.tex", "b.TYP", "refs.bib", "x.cls", "x.sty", "x.bst", "n.txt", "n.md", "c.yaml", "c.yml", "d.json", "e.csv"])(
    "accepts %s", (path) => { expect(isSearchableFile(path)).toBe(true); },
  );

  it.each(["fig.pdf", "fig.png", "main.tex.bak", "tex", "main.aux"])("rejects %s", (path) => {
    expect(isSearchableFile(path)).toBe(false);
  });
});
