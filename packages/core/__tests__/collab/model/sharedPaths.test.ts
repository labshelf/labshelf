/** Verifies which project files a share holds and which of them are text docs. */
import { sharedFileKind, sharedPaths } from "../../../src/collab/model/index";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("sharedPaths", () => {
  it("shares sources, figures and labshelf.bib but not labshelf.yaml, build output or VCS folders", () => {
    const list = [
      "labshelf.yaml", "labshelf.bib", "main.tex", "main.aux", "main.log", "main.synctex.gz", "main.pdf",
      "fig/plot.pdf", "refs.bib", ".git/HEAD", "sub/.svn/entries",
    ];
    expect(sharedPaths(list)).toEqual(["labshelf.bib", "main.tex", "fig/plot.pdf", "refs.bib"]);
  });

  it("admits only the checklist of .labshelf/, because comments travel in the index doc", () => {
    const list = [".labshelf/checklist.json", ".labshelf/comments.json", ".labshelf/state.json", "sub/.labshelf/checklist.json"];
    expect(sharedPaths(list)).toEqual([".labshelf/checklist.json"]);
  });

  it("drops the built PDF of a Typst root in a subfolder", () => {
    expect(sharedPaths(["ch/a.typ", "ch/a.pdf", "ch/b.pdf"])).toEqual(["ch/a.typ", "ch/b.pdf"]);
  });
});

describe("sharedFileKind", () => {
  it("makes UTF-8 files with a text extension text docs", () => {
    expect(sharedFileKind("main.tex", utf8("café"))).toBe("text");
    expect(sharedFileKind(".labshelf/checklist.json", utf8("{}"))).toBe("text");
  });

  it("makes other extensions and invalid UTF-8 blobs", () => {
    expect(sharedFileKind("fig.png", utf8("png"))).toBe("blob");
    expect(sharedFileKind("main.tex", new Uint8Array([0x63, 0xe9]))).toBe("blob");
  });
});
