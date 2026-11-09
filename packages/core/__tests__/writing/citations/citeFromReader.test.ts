/** Verifies what citing from the reader offers in a project, the citation it writes and the papers entry that puts a paper in labshelf.bib. */
import type { PaperRecord } from "../../../src/model/index";
import { createReaderCitation, deriveReaderCiteChoices, isInProjectBibliography, listListedCiteKeys, withListedPaper } from "../../../src/writing/citations/index";

const paper = { id: "p1", citeKey: "smith2020", doi: "10.1/x", path: "papers/ml/smith2020", title: "T" } as PaperRecord;

describe("deriveReaderCiteChoices", () => {
  it("cites into the open source, with the quotation, and offers labshelf.bib when the paper is not in it", () => {
    const choices = deriveReaderCiteChoices({ format: "latex", settings: {} }, paper, { page: 4, quote: "  A  passage " }, "intro.tex");
    expect(choices).toEqual([
      { action: "cite", label: "Insert in intro.tex", description: "\\cite[p.~4]{smith2020}" },
      { action: "citeQuoted", label: "Insert in intro.tex with the quotation", description: "“A passage”" },
      { action: "bibliography", label: "Only add to labshelf.bib", description: "cite it later" },
    ]);
  });

  it("copies when no source is open and leaves out labshelf.bib when the paper is listed", () => {
    const choices = deriveReaderCiteChoices({ format: "typst", settings: { papers: [{ key: "smith2020" }], bibliography: "refs.bib" } }, paper, {}, undefined);
    expect(choices).toEqual([{ action: "cite", label: "Copy the citation", description: "@smith2020" }]);
  });
});

describe("isInProjectBibliography", () => {
  it("counts listed papers and papers of linked folders", () => {
    expect(isInProjectBibliography({ papers: [{ key: "smith2020", cited: true }] }, paper)).toBe(true);
    expect(isInProjectBibliography({ libraryFolders: ["ml"] }, paper)).toBe(true);
    expect(isInProjectBibliography({ libraryFolders: ["bio"] }, paper)).toBe(false);
  });
});

describe("createReaderCitation", () => {
  it("writes the quotation only when asked", () => {
    expect(createReaderCitation("typst", "k", { page: 2, quote: "q" }, true)).toBe("\"q\" @k[p. 2]");
    expect(createReaderCitation("typst", "k", { page: 2, quote: "q" }, false)).toBe("@k[p. 2]");
  });
});

describe("withListedPaper", () => {
  it("appends the paper, turns a synced entry into the user's, and leaves a user's entry alone", () => {
    expect(withListedPaper([], paper)).toEqual([{ key: "smith2020", doi: "10.1/x" }]);
    expect(withListedPaper([{ key: "a" }, { key: "smith2020", cited: true }], paper)).toEqual([{ key: "a" }, { key: "smith2020", doi: "10.1/x" }]);
    expect(withListedPaper([{ key: "smith2020" }], paper)).toBeUndefined();
  });
});

describe("listListedCiteKeys", () => {
  it("keeps the user's entries that name a library paper", () => {
    const library = new Map([["a", paper], ["b", paper]]);
    expect(listListedCiteKeys([{ key: "a" }, { key: "b", cited: true }, { key: "c" }], library)).toEqual(["a"]);
  });
});
