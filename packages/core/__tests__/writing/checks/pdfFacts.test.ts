/** Verifies reading a PDF's facts through pdf.js, splitting the paper body at its references heading and counting the pages and words a venue limit applies to. */
import type { PdfjsLoader } from "../../../src/import/index";
import { readLatexProjectSources } from "../../../src/latex/sourceProject";
import { countWordsUpTo, derivePaperBody, derivePdfTextLines, deriveReadingOrderTexts, readPdfFacts, walkOperators } from "../../../src/writing/checks/pdfFacts";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

describe("derivePdfTextLines", () => {
  it("joins the pieces of a line and ends it at an item flagged hasEOL", () => {
    const items = [{ str: "Hello " }, { str: "world", hasEOL: true }, { str: "Second", hasEOL: true }];
    expect(derivePdfTextLines(items)).toEqual(["Hello world", "Second"]);
  });

  it("keeps a trailing line that has no end-of-line item", () => {
    expect(derivePdfTextLines([{ str: "a", hasEOL: true }, { str: "b" }, { str: "c" }])).toEqual(["a", "bc"]);
  });

  it("keeps empty lines made by an empty hasEOL item and treats a missing str as empty", () => {
    expect(derivePdfTextLines([{ str: "a", hasEOL: true }, { hasEOL: true }, { str: "b", hasEOL: true }])).toEqual(["a", "", "b"]);
  });

  it("returns no lines for no items", () => {
    expect(derivePdfTextLines([])).toEqual([]);
  });
});

describe("operatorWalk", () => {
  const OPS = { save: 10, restore: 11, transform: 12, setFont: 37, paintImageXObject: 85, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, showText: 44 };

  function list(ops: Array<[keyof typeof OPS, unknown]>) {
    return { fnArray: ops.map(([name]) => OPS[name]), argsArray: ops.map(([, args]) => args) };
  }

  describe("walkOperators", () => {
    it("collects each font once, in first-use order", () => {
      const result = walkOperators(list([["setFont", ["f2", 10]], ["showText", null], ["setFont", ["f1", 9]], ["setFont", ["f2", 10]]]), OPS);
      expect(result.fontIds).toEqual(["f2", "f1"]);
    });

    it("sizes an image by the transform it is drawn under, as pdfTeX writes it", () => {
      const result = walkOperators(list([
        ["transform", [1, 0, 0, 1, 148.7, 488.4]],
        ["save", null],
        ["transform", [2.88, 0, 0, 2.88, 0, 0]],
        ["save", null],
        ["transform", [50, 0, 0, 50, 0, 0]],
        ["paintImageXObject", ["img", 50, 50]],
        ["restore", null],
        ["restore", null],
      ]), OPS);
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toMatchObject({ pixelWidth: 50, pixelHeight: 50 });
      expect(result.images[0]!.width).toBeCloseTo(144);
      expect(result.images[0]!.height).toBeCloseTo(144);
    });

    it("undoes a transform on restore and applies a form's matrix only inside the form", () => {
      const result = walkOperators(list([
        ["save", null],
        ["transform", [10, 0, 0, 10, 0, 0]],
        ["restore", null],
        ["paintFormXObjectBegin", [[0, 2, -3, 0, 5, 5], [0, 0, 1, 1]]],
        ["paintImageXObject", ["a", 100, 300]],
        ["paintFormXObjectEnd", null],
        ["paintImageXObject", ["b", 10, 10]],
      ]), OPS);
      expect(result.images.map(({ width, height }) => [width, height])).toEqual([[2, 3], [1, 1]]);
    });

    it("survives an unbalanced restore", () => {
      const result = walkOperators(list([["restore", null], ["paintImageXObject", ["a", 1, 1]]]), OPS);
      expect(result.images).toEqual([{ pixelWidth: 1, pixelHeight: 1, width: 1, height: 1 }]);
    });
  });
});

describe("readPdfFacts", () => {
  function loaderFor(received: { data?: Uint8Array }) {
    const destroy = jest.fn(async () => undefined);
    const page = {
      getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      getTextContent: async () => ({ items: [] }),
      commonObjs: { has: () => false, get: () => undefined },
    };
    const document = { numPages: 2, getPage: async () => page, getMetadata: async () => ({ info: { Author: "Jane", Trapped: 3 } }) };
    const loader = {
      load: async () => ({ OPS: {} }),
      getDocument: async (source: { data: Uint8Array }) => { received.data = source.data; return { promise: Promise.resolve(document), destroy }; },
    } as unknown as PdfjsLoader;
    return { loader, destroy };
  }

  describe("readPdfFacts", () => {
    it("reads the PDF bytes through the port, keeps text info fields and destroys the task", async () => {
      const fs = new MemoryLibraryFs();
      await fs.writeFile("/p/out.pdf", new Uint8Array([1, 2, 3]));
      const received: { data?: Uint8Array } = {};
      const { loader, destroy } = loaderFor(received);

      const facts = await readPdfFacts(fs, loader, "/p/out.pdf");

      expect([...received.data!]).toEqual([1, 2, 3]);
      expect(facts.pages).toHaveLength(2);
      expect(facts.info).toEqual({ Author: "Jane" });
      expect(destroy).toHaveBeenCalled();
    });

    it("rejects a missing PDF", async () => {
      await expect(readPdfFacts(new MemoryLibraryFs(), loaderFor({}).loader, "/p/missing.pdf")).rejects.toThrow(/ENOENT/);
    });
  });
});

describe("derivePaperBody", () => {
  const header = "Under review as a conference paper at ICLR 2027";

  describe("derivePaperBody", () => {
    it("counts every page when there is no references heading", () => {
      expect(derivePaperBody([["a"], ["b"]])).toEqual({ contentPages: 2, headingFound: false, pages: [["a"], ["b"]] });
    });

    it("counts the heading's page when body text precedes the heading on it", () => {
      const body = derivePaperBody([["Intro", "1"], ["Conclusion text", "6 References", "[1] Doe. 2020.", "2"]]);
      expect(body.contentPages).toBe(2);
      expect(body.pages).toEqual([["Intro", "1"], ["Conclusion text"]]);
    });

    it("does not count a page that starts with the references under a running header", () => {
      const body = derivePaperBody([[header, "Intro", "1"], [header, "Method", "2"], [header, "References", "[1] Doe.", "3"]]);
      expect(body).toMatchObject({ contentPages: 2, headingFound: true });
      expect(body.pages[2]).toEqual([header]);
    });

    it.each(["References", "REFERENCES", "Bibliography", "7 References", "A. References", "7.1. References"])("recognises the heading %j", (heading) => {
      expect(derivePaperBody([["text"], [heading]]).contentPages).toBe(1);
    });

    it("ignores a sentence that mentions references", () => {
      expect(derivePaperBody([["text"], ["References to prior work are in Section 2."]]).headingFound).toBe(false);
    });
  });
});

describe("countSourceWords", () => {
  const DOC = String.raw`\documentclass{article}
\begin{document}
one two three
\bibliographystyle{plain}
\bibliography{refs}
four five
\end{document}`;

  describe("countWordsUpTo", () => {
    it("stops at the bibliography command for references", () => {
      expect(countWordsUpTo([{ text: DOC }], "references")).toBe(3);
    });

    it("stops at printbibliography and at the Typst bibliography call", () => {
      expect(countWordsUpTo([{ text: String.raw`\begin{document} a b \printbibliography c d \end{document}` }], "references")).toBe(2);
      expect(countWordsUpTo([{ text: "a b c\n#bibliography(\"refs.bib\")\nd e" }], "references")).toBe(3);
    });

    it("ignores a bibliography command in a comment", () => {
      expect(countWordsUpTo([{ text: "a b\n% \\bibliography{x}\nc\n\\bibliography{x} d" }], "references")).toBe(3);
    });

    it("counts through the references for end and stops at the end of the document", () => {
      expect(countWordsUpTo([{ text: DOC }], "end")).toBe(5);
    });

    it("counts a text without a bibliography in full", () => {
      expect(countWordsUpTo([{ text: "a b c" }], "references")).toBe(3);
    });

    it("joins the sources in the order given, so an include before the bibliography counts", () => {
      const parts = [{ text: String.raw`\begin{document} a b` }, { text: "c d e" }, { text: String.raw`f \bibliography{r} g h \end{document}` }];
      expect(countWordsUpTo(parts, "references")).toBe(6);
      expect(countWordsUpTo(parts, "end")).toBe(8);
    });
  });
});

describe("deriveReadingOrderTexts", () => {
  async function flatten(files: Record<string, string>) {
    const texts = new Map<string, string>();
    const tree = await readLatexProjectSources("main.tex", {
      read: async (path) => {
        const text = files[path];
        if (text !== undefined) { texts.set(path, text); }
        return text;
      },
    });
    return deriveReadingOrderTexts(tree.files, texts);
  }

  describe("deriveReadingOrderTexts", () => {
    it("places an included file at its include and the rest of the parent after it", async () => {
      const parts = await flatten({ "main.tex": "A\n\\input{intro}\nB", "intro.tex": "I" });
      expect(parts.map((part) => part.text.trim())).toEqual(["A", "I", "B"]);
    });

    it("follows an \\input chain and reads a file included twice once", async () => {
      const parts = await flatten({
        "main.tex": "\\input{a}\\input{a}\nM",
        "a.tex": "A \\input{b}",
        "b.tex": "B",
      });
      expect(countWordsUpTo(parts, "end")).toBe(3);
    });

    it("counts the files after the bibliography out when the main file places them there", async () => {
      const parts = await flatten({
        "main.tex": "\\begin{document}\nm1\n\\input{body}\n\\bibliography{r}\n\\appendix\n\\input{appendix}\n\\end{document}",
        "body.tex": "b1 b2 b3",
        "appendix.tex": "x1 x2 x3 x4",
      });
      expect(countWordsUpTo(parts, "references")).toBe(4);
      expect(countWordsUpTo(parts, "end")).toBe(8);
    });
  });
});
