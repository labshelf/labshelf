/** Verifies the export of a project: the files of a zip and an arXiv bundle, the pandoc command line, the install plan and the words install uses. */
import type { ImportOutcome } from "../../../src/library";
import type { PaperRecord } from "../../../src/model";
import {
  createArxivBundle, createInstallPlan, createPandocArgs, deriveProjectFiles, describeInstall, describeInstallReport,
  DOCUMENT_EXPORT_EXTENSIONS, listBibliographyFiles, type InstallResult,
} from "../../../src/writing/project/index";

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

const paper = (id: string, citeKey: string, doi?: string): PaperRecord =>
  ({ id, title: id, path: id, citeKey, status: "unread", ...(doi ? { doi } : {}) }) as PaperRecord;

const library = [paper("a-folder", "alpha2020", "10.1/Alpha"), paper("beta", "beta2021", "10.1/beta")];

describe("createInstallPlan", () => {
  it("classifies each listed paper, keeping the listed order", () => {
    const plan = createInstallPlan(
      [{ key: "beta2021", doi: "10.9/x" }, { key: "alpha", doi: "10.1/alpha" }, { key: "nodoi" }, { key: "gamma", doi: "10.1/gamma" }],
      library,
    );
    expect(plan).toEqual([
      { kind: "present", key: "beta2021" },
      { kind: "other-key", key: "alpha", existingKey: "alpha2020" },
      { kind: "no-doi", key: "nodoi" },
      { kind: "import", key: "gamma", doi: "10.1/gamma" },
    ]);
  });

  it("finds a paper by cite key even when its DOI differs or is missing from the list", () => {
    expect(createInstallPlan([{ key: "alpha2020" }], library)).toEqual([{ kind: "present", key: "alpha2020" }]);
  });

  it("refuses a key that could name a path outside the library", () => {
    expect(createInstallPlan([{ key: "../evil", doi: "10.1/z" }, { key: "a/b", doi: "10.1/y" }, { key: ".hidden", doi: "10.1/w" }], []))
      .toEqual([{ kind: "bad-key", key: "../evil" }, { kind: "bad-key", key: "a/b" }, { kind: "bad-key", key: ".hidden" }]);
  });

  it("plans a key listed twice once", () => {
    expect(createInstallPlan([{ key: "g", doi: "10.1/g" }, { key: "g", doi: "10.1/g" }], [])).toEqual([{ kind: "import", key: "g", doi: "10.1/g" }]);
  });
});

const record = (citeKey: string, hasPdf: boolean): PaperRecord => ({ id: citeKey, title: "T", path: citeKey, citeKey, status: "unread", hasPdf }) as PaperRecord;
const added = (citeKey: string, hasPdf = true): ImportOutcome => ({ status: "added", record: record(citeKey, hasPdf), needsReview: false, input: "10.1/x" });
const toImport = (key: string, outcome: ImportOutcome): InstallResult => ({ entry: { kind: "import", key, doi: "10.1/x" }, outcome });

describe("describeInstall", () => {
  it("words every kind of entry and every import outcome", () => {
    const lines = (results: InstallResult[]) => results.map((r) => describeInstall(r).text);
    expect(lines([
      { entry: { kind: "present", key: "a" } },
      { entry: { kind: "other-key", key: "b", existingKey: "b2020" } },
      { entry: { kind: "no-doi", key: "c" } },
      toImport("d", added("d")),
      toImport("e", added("e", false)),
      toImport("f", added("f2")),
      toImport("g", { status: "failed", error: "Could not find DOI 10.1/x", input: "10.1/x" }),
      toImport("h", { status: "duplicate", existingId: "h9", input: "10.1/x" }),
    ])).toEqual([
      "a: already in the library",
      "b: in the library as b2020; cite it by that key or rename the paper",
      "c: no DOI listed, cannot install",
      "d: added",
      "e: added without a PDF",
      "f: added as f2 because f was taken",
      "g: failed: Could not find DOI 10.1/x",
      "h: in the library as h9; cite it by that key or rename the paper",
    ]);
  });
});

describe("describeInstallReport", () => {
  it("counts what was added, was there already and still does not resolve", () => {
    const summary = describeInstallReport([
      { entry: { kind: "present", key: "a" } },
      toImport("d", added("d")),
      toImport("e", added("e", false)),
      { entry: { kind: "no-doi", key: "c" } },
    ]);
    expect(summary).toEqual({ level: "warn", text: "2 added, 1 already in the library, 1 without a PDF, 1 not resolved" });
  });

  it("is quiet when every key resolves with its PDF", () => {
    expect(describeInstallReport([toImport("d", added("d"))])).toEqual({ level: "info", text: "1 added, 0 already in the library" });
  });

  it("says so when the project lists nothing", () => {
    expect(describeInstallReport([])).toEqual({ level: "info", text: "The project lists no papers" });
  });
});

describe("createPandocArgs", () => {
  it("reads LaTeX and writes Word", () => {
    expect(createPandocArgs("latex", "main.tex", "docx", "/out/paper.docx"))
      .toEqual(["--from", "latex", "--to", "docx", "--output", "/out/paper.docx", "main.tex"]);
  });

  it("reads Typst and writes GitHub Markdown", () => {
    expect(createPandocArgs("typst", "main.typ", "markdown", "/out/paper.md"))
      .toEqual(["--from", "typst", "--to", "gfm", "--output", "/out/paper.md", "main.typ"]);
  });

  it("writes HTML as a standalone page", () => {
    expect(createPandocArgs("latex", "main.tex", "html", "/out/paper.html"))
      .toEqual(["--from", "latex", "--to", "html", "--standalone", "--output", "/out/paper.html", "main.tex"]);
  });

  it("names the file extension of each export", () => {
    expect(DOCUMENT_EXPORT_EXTENSIONS).toEqual({ docx: "docx", markdown: "md", html: "html" });
  });
});
