/** Verifies which project files Search in Project reads. */
import { isSearchTextFile } from "../../../src/writing/search/index";

describe("isSearchTextFile", () => {
  it.each(["a/main.tex", "b.TYP", "refs.bib", "x.cls", "x.sty", "x.bst", "n.txt", "n.md", "c.yaml", "c.yml", "d.json", "e.csv"])(
    "accepts %s", (path) => { expect(isSearchTextFile(path)).toBe(true); },
  );

  it.each(["fig.pdf", "fig.png", "main.tex.bak", "tex", "main.aux"])("rejects %s", (path) => {
    expect(isSearchTextFile(path)).toBe(false);
  });
});
