/** Verifies which files a project zip and an arXiv bundle contain. */
import { createArxivBundle, listBibliographyFiles, deriveProjectFiles } from "../../../src/writing/project/index";

describe("createProjectFiles", () => {
  it("drops build output, labshelf.bib, .labshelf and VCS folders", () => {
    const list = [
      "main.tex", "main.aux", "main.log", "main.out", "main.toc", "main.fls", "main.fdb_latexmk",
      "main.synctex.gz", "main.bcf", "main.run.xml", "main.blg", "main.pdf",
      "labshelf.bib", ".labshelf/state.json", ".git/HEAD", "sub/.git/config", ".svn/entries", ".hg/store",
    ];
    expect(deriveProjectFiles(list)).toEqual(["main.tex"]);
  });

  it("keeps labshelf.yaml, figures, .bbl, .cls, .sty and PDFs that are not a root's output", () => {
    const list = ["labshelf.yaml", "main.tex", "main.bbl", "fig/plot.pdf", "x.cls", "x.sty", "refs.bib"];
    expect(deriveProjectFiles(list)).toEqual(["labshelf.yaml", "main.tex", "main.bbl", "fig/plot.pdf", "x.cls", "x.sty", "refs.bib"]);
  });

  it("drops the PDF of a Typst root and of a root in a subfolder", () => {
    expect(deriveProjectFiles(["paper.typ", "paper.pdf", "ch/a.tex", "ch/a.pdf", "ch/fig.pdf"]))
      .toEqual(["paper.typ", "ch/a.tex", "ch/fig.pdf"]);
  });

  it("does not drop a file that only contains a build extension in its name", () => {
    expect(deriveProjectFiles(["logo.log.png", "notes.logic.tex"])).toEqual(["logo.log.png", "notes.logic.tex"]);
  });
});

describe("listBibliographyFiles", () => {
  it("parses \\bibliography lists and adds .bib when missing", () => {
    expect(listBibliographyFiles("\\bibliography{a,b.bib, c}", "labshelf.bib")).toEqual(["a.bib", "b.bib", "c.bib"]);
  });

  it("parses \\addbibresource", () => {
    const text = "\\addbibresource{x.bib}\n\\addbibresource[label=y]{sub/y.bib}";
    expect(listBibliographyFiles(text, "labshelf.bib")).toEqual(["x.bib", "sub/y.bib"]);
  });

  it("never returns the generated bibliography", () => {
    expect(listBibliographyFiles("\\bibliography{labshelf,refs}\n\\addbibresource{labshelf.bib}", "labshelf.bib")).toEqual(["refs.bib"]);
    expect(listBibliographyFiles("\\bibliography{mine}", "mine.bib")).toEqual([]);
  });

  it("ignores commented lines and repeated files", () => {
    expect(listBibliographyFiles("% \\bibliography{old}\n\\bibliography{a}\n\\addbibresource{a.bib}", "labshelf.bib")).toEqual(["a.bib"]);
  });
});

describe("createArxivBundle", () => {
  const bib = [
    "@string{ieee = {IEEE}}",
    "% keep me",
    "@article{used, title={A}, publisher=ieee}",
    "",
    "@book{unused, title={B}}",
    "@misc{alsoUsed, title={C}}",
    "",
  ].join("\n");

  it("keeps cited entries, @string and comments, and cuts uncited entries up to their closing brace", () => {
    const { bibs } = createArxivBundle(["main.tex", "refs.bib"], [{ path: "refs.bib", text: bib }], ["used", "alsoUsed"]);
    expect(bibs).toEqual([{
      path: "refs.bib",
      text: ["@string{ieee = {IEEE}}", "% keep me", "@article{used, title={A}, publisher=ieee}", "", "", "@misc{alsoUsed, title={C}}", ""].join("\n"),
    }]);
  });

  it("cuts exactly [start, end): the character after the closing brace stays", () => {
    const { bibs } = createArxivBundle([], [{ path: "r.bib", text: "@misc{a,}X@misc{b,}Y" }], ["b"]);
    expect(bibs[0]!.text).toBe("X@misc{b,}Y");
  });

  it("removes the rewritten .bib files and labshelf.bib from the file list and keeps the .bbl", () => {
    const { files } = createArxivBundle(
      ["main.tex", "main.bbl", "refs.bib", "labshelf.bib", "fig.png", "main.aux"],
      [{ path: "refs.bib", text: bib }],
      ["used"],
    );
    expect(files).toEqual(["main.tex", "main.bbl", "fig.png"]);
  });

  it("never includes labshelf.bib even when passed as a bib", () => {
    const { bibs } = createArxivBundle(["main.tex"], [{ path: "labshelf.bib", text: "@misc{used,}" }, { path: "refs.bib", text: "@misc{used,}" }], ["used"]);
    expect(bibs.map((entry) => entry.path)).toEqual(["refs.bib"]);
  });
});
