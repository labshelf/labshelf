/** Verifies which files a project zip and an arXiv bundle contain. */
import { arxivBundle, bibliographyFiles, projectFiles } from "../../../src/writing/project/index";

describe("projectFiles", () => {
  it("drops build output, labshelf.bib, .labshelf and VCS folders", () => {
    const list = [
      "main.tex", "main.aux", "main.log", "main.out", "main.toc", "main.fls", "main.fdb_latexmk",
      "main.synctex.gz", "main.bcf", "main.run.xml", "main.blg", "main.pdf",
      "labshelf.bib", ".labshelf/state.json", ".git/HEAD", "sub/.git/config", ".svn/entries", ".hg/store",
    ];
    expect(projectFiles(list)).toEqual(["main.tex"]);
  });

  it("keeps labshelf.yaml, figures, .bbl, .cls, .sty and PDFs that are not a root's output", () => {
    const list = ["labshelf.yaml", "main.tex", "main.bbl", "fig/plot.pdf", "x.cls", "x.sty", "refs.bib"];
    expect(projectFiles(list)).toEqual(["labshelf.yaml", "main.tex", "main.bbl", "fig/plot.pdf", "x.cls", "x.sty", "refs.bib"]);
  });

  it("drops the PDF of a Typst root and of a root in a subfolder", () => {
    expect(projectFiles(["paper.typ", "paper.pdf", "ch/a.tex", "ch/a.pdf", "ch/fig.pdf"]))
      .toEqual(["paper.typ", "ch/a.tex", "ch/fig.pdf"]);
  });

  it("does not drop a file that only contains a build extension in its name", () => {
    expect(projectFiles(["logo.log.png", "notes.logic.tex"])).toEqual(["logo.log.png", "notes.logic.tex"]);
  });
});

describe("bibliographyFiles", () => {
  it("parses \\bibliography lists and adds .bib when missing", () => {
    expect(bibliographyFiles("\\bibliography{a,b.bib, c}", "labshelf.bib")).toEqual(["a.bib", "b.bib", "c.bib"]);
  });

  it("parses \\addbibresource", () => {
    const text = "\\addbibresource{x.bib}\n\\addbibresource[label=y]{sub/y.bib}";
    expect(bibliographyFiles(text, "labshelf.bib")).toEqual(["x.bib", "sub/y.bib"]);
  });

  it("never returns the generated bibliography", () => {
    expect(bibliographyFiles("\\bibliography{labshelf,refs}\n\\addbibresource{labshelf.bib}", "labshelf.bib")).toEqual(["refs.bib"]);
    expect(bibliographyFiles("\\bibliography{mine}", "mine.bib")).toEqual([]);
  });

  it("ignores commented lines and repeated files", () => {
    expect(bibliographyFiles("% \\bibliography{old}\n\\bibliography{a}\n\\addbibresource{a.bib}", "labshelf.bib")).toEqual(["a.bib"]);
  });
});

describe("arxivBundle", () => {
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
    const { bibs } = arxivBundle(["main.tex", "refs.bib"], [{ path: "refs.bib", text: bib }], ["used", "alsoUsed"]);
    expect(bibs).toEqual([{
      path: "refs.bib",
      text: ["@string{ieee = {IEEE}}", "% keep me", "@article{used, title={A}, publisher=ieee}", "", "", "@misc{alsoUsed, title={C}}", ""].join("\n"),
    }]);
  });

  it("cuts exactly [start, end): the character after the closing brace stays", () => {
    const { bibs } = arxivBundle([], [{ path: "r.bib", text: "@misc{a,}X@misc{b,}Y" }], ["b"]);
    expect(bibs[0]!.text).toBe("X@misc{b,}Y");
  });

  it("removes the rewritten .bib files and labshelf.bib from the file list and keeps the .bbl", () => {
    const { files } = arxivBundle(
      ["main.tex", "main.bbl", "refs.bib", "labshelf.bib", "fig.png", "main.aux"],
      [{ path: "refs.bib", text: bib }],
      ["used"],
    );
    expect(files).toEqual(["main.tex", "main.bbl", "fig.png"]);
  });

  it("never includes labshelf.bib even when passed as a bib", () => {
    const { bibs } = arxivBundle(["main.tex"], [{ path: "labshelf.bib", text: "@misc{used,}" }, { path: "refs.bib", text: "@misc{used,}" }], ["used"]);
    expect(bibs.map((entry) => entry.path)).toEqual(["refs.bib"]);
  });
});
