/** Verifies the cite keys a LaTeX or Typst source cites, where a key or page argument is being typed, the citation text, the picker words, headings and citation sites, the suggested key and papers by cite key. */
import { findCiteKeyOccurrences, scanCiteKeys, findPartialCiteKeyStart, derivePageArgument, createCitationSnippet, derivePageSupplement, deriveQuotationBefore, deriveChoiceCitationSpec, formatHighlightLabel, formatHighlightPage, derivePaperPickText, findCitationSites, findSourceHeadings, deriveSuggestedCiteKey } from "../../../src/writing/citations/index";
import type { Annotation, PaperRecord } from "../../../src/model/index";

describe("scanCiteKeys in LaTeX", () => {
  it.each([
    ["\\cite{a}", ["a"]],
    ["\\citep[p.~3]{a, b}", ["a", "b"]],
    ["\\citet*[see][ch. 2]{a}", ["a"]],
    ["\\autocite{a} \\parencite{b} \\textcite{c} \\footcite{d}", ["a", "b", "c", "d"]],
    ["\\nocite{a}\\Citeauthor{b}", ["a", "b"]],
    ["\\cite {a}", ["a"]],
  ])("finds the keys of %s", (text, keys) => {
    expect(scanCiteKeys("latex", text)).toEqual(keys);
  });

  it("ignores commented-out citations but not an escaped percent", () => {
    expect(scanCiteKeys("latex", "50\\% of \\cite{kept} % \\cite{dropped}\n% \\cite{gone}")).toEqual(["kept"]);
  });

  it("drops duplicates, empty keys and the cite-everything star", () => {
    expect(scanCiteKeys("latex", "\\cite{a,,a}\\nocite{*}\\cite{b}")).toEqual(["a", "b"]);
  });
});

describe("scanCiteKeys in Typst", () => {
  it.each([
    ["see @smith2020.", ["smith2020"]],
    ["@a:b and @c_d-e", ["a:b", "c_d-e"]],
    ["#cite(<a>) #cite(label(\"b\"), form: \"prose\")", ["a", "b"]],
    ["@café2021", ["café2021"]],
  ])("finds the keys of %s", (text, keys) => {
    expect(scanCiteKeys("typst", text)).toEqual(keys);
  });

  it("ignores e-mail addresses and comments", () => {
    const text = "mail me@example.org // @line\n/* @block\n@still */ @kept https://x.org/@user";
    expect(scanCiteKeys("typst", text)).toEqual(["kept"]);
  });
});

describe("findCiteKeyOccurrences page and command", () => {
  it.each([
    ["\\cite[p.~4]{a}", 4],
    ["\\cite[see][p.~4]{a}", 4],
    ["\\citep[p.~12]{a}", 12],
  ])("reads the page of %s", (text, page) => {
    expect(findCiteKeyOccurrences("latex", text).map((cited) => cited.page)).toEqual([page]);
  });

  it("leaves the page out when no argument names one", () => {
    const [plain, other] = findCiteKeyOccurrences("latex", "\\cite{a} \\cite[see]{b} \\cite[ch. 2]{c}");
    expect(plain).not.toHaveProperty("page");
    expect(other).not.toHaveProperty("page");
    expect(findCiteKeyOccurrences("typst", "@a")[0]).not.toHaveProperty("page");
  });

  it("gives every key of a command the command text and page", () => {
    const [first, second] = findCiteKeyOccurrences("latex", "x \\citep[p.~4]{a, b} y");
    expect(first).toMatchObject({ key: "a", page: 4, command: "\\citep[p.~4]{a, b}" });
    expect(second).toMatchObject({ key: "b", page: 4, command: "\\citep[p.~4]{a, b}" });
  });

  it("gives a Typst reference and cite call as the command", () => {
    expect(findCiteKeyOccurrences("typst", "see @a and #cite(<b>)").map((cited) => cited.command)).toEqual(["@a", "#cite(<b>)"]);
  });
});

describe("findPartialCiteKeyStart in LaTeX", () => {
  it.each([
    ["\\cite{", 6],
    ["See \\citep{vasw", 11],
    ["\\cite[p. 3]{a, b", 15],
    ["\\textcite*[see][p. 3]{a,  b", 26],
    ["\\autocite{a,", 12],
  ])("starts the partial key of %j at column %i", (prefix, column) => {
    expect(findPartialCiteKeyStart("latex", prefix)).toBe(column);
  });

  it.each(["\\cite{a}", "\\cite{a} and ", "\\section{", "{", "\\cite", "plain text, more"])(
    "is outside a cite for %j", (prefix) => {
      expect(findPartialCiteKeyStart("latex", prefix)).toBeUndefined();
    },
  );
});

describe("findPartialCiteKeyStart in Typst", () => {
  it.each([
    ["see @", 5],
    ["see @vasw", 5],
    ["(@a, @he20", 6],
    ["#cite(<", 7],
    ["#cite( <he20", 8],
  ])("starts the partial key of %j at column %i", (prefix, column) => {
    expect(findPartialCiteKeyStart("typst", prefix)).toBe(column);
  });

  it.each(["mail me@home", "a <b", "plain text", "#cite(<a>", "x_@"])("is outside a reference for %j", (prefix) => {
    expect(findPartialCiteKeyStart("typst", prefix)).toBeUndefined();
  });
});

describe("findCiteKeyOccurrences", () => {
  const slice = (text: string, cited: { start: number; end: number }) => text.slice(cited.start, cited.end);

  it("locates every key of a LaTeX cite list, trimmed", () => {
    const text = "x \\cite[p. 2]{ a1 , b2 }\ny \\nocite{*} \\citep{c3}";
    const found = findCiteKeyOccurrences("latex", text);
    expect(found.map((cited) => cited.key)).toEqual(["a1", "b2", "c3"]);
    expect(found.map((cited) => slice(text, cited))).toEqual(["a1", "b2", "c3"]);
  });

  it("ignores LaTeX comments but keeps offsets", () => {
    const text = "% \\cite{no}\n\\cite{yes} 50\\% \\cite{also}";
    const found = findCiteKeyOccurrences("latex", text);
    expect(found.map((cited) => slice(text, cited))).toEqual(["yes", "also"]);
  });

  it("locates Typst references and cite labels, without trailing punctuation", () => {
    const text = "As @a1. and #cite(<b2>) but mail me@x.org, see https://x.org/@no // @c3\n@d4:";
    const found = findCiteKeyOccurrences("typst", text);
    expect(found.map((cited) => slice(text, cited)).sort()).toEqual(["a1", "b2", "d4"]);
  });
});

function at(format: "latex" | "typst", marked: string) {
  const cursor = marked.indexOf("|");
  return derivePageArgument(format, marked.slice(0, cursor), marked.slice(cursor + 1));
}

describe("derivePageArgument in LaTeX", () => {
  it("has no key while the command has no key list yet", () => {
    expect(at("latex", "See \\cite[|")).toEqual({ start: 10, hasKeys: false, commandStart: 4 });
  });

  it("reads the single key after the argument and the column of the closing bracket", () => {
    expect(at("latex", "\\citep[p.~|]{he2016}")).toEqual({ key: "he2016", start: 7, close: 10, hasKeys: true, commandStart: 0 });
  });

  it("reports an auto-closed bracket with no key list", () => {
    expect(at("latex", "\\cite[|]")).toEqual({ start: 6, close: 6, hasKeys: false, end: 7, commandStart: 0 });
  });

  it.each([["\\cite[|]{}", 9], ["\\cite[|]{ }", 10], ["\\cite[|] [x] {}", 14]])("ends an empty key list of %s after its brace", (marked, end) => {
    expect(at("latex", marked)).toMatchObject({ hasKeys: false, end });
  });

  it("names no key when the list has several", () => {
    expect(at("latex", "\\cite[|]{a, b}")).toEqual({ start: 6, close: 6, hasKeys: true, commandStart: 0 });
  });

  it("accepts starred commands, spaces and a second optional argument after the first", () => {
    expect(at("latex", "\\autocite* [|][ch. 2]{a}")?.key).toBe("a");
  });

  it.each([
    ["\\cite{|"],
    ["\\cite[p. 4]|"],
    ["\\cite[p. 4]{a} and [|"],
    ["\\section[|"],
    ["\\cite[see][|"],
  ])("finds nothing in %s", (marked) => {
    expect(at("latex", marked)).toBeUndefined();
  });
});

describe("derivePageArgument in Typst", () => {
  it("reads the key and where the supplement starts", () => {
    expect(at("typst", "As in @he2016[p|] it")).toEqual({ key: "he2016", start: 14, close: 15, hasKeys: true, commandStart: 6 });
  });

  it("has no close when the bracket is open", () => {
    expect(at("typst", "@he2016[|")?.close).toBeUndefined();
  });

  it.each([["me@home[|"], ["@he2016|"], ["#f(x)[|"]])("finds nothing in %s", (marked) => {
    expect(at("typst", marked)).toBeUndefined();
  });
});

describe("derivePageSupplement", () => {
  it("keeps the page on the line of `p.` in LaTeX and uses a plain space in Typst", () => {
    expect(derivePageSupplement("latex", 4)).toBe("p.~4");
    expect(derivePageSupplement("typst", 4)).toBe("p. 4");
  });
});

describe("deriveQuotationBefore", () => {
  it("quotes with LaTeX quotation marks and a tie to the citation", () => {
    expect(deriveQuotationBefore("latex", "Attention is\n  all you need")).toBe("``Attention is all you need''~");
  });

  it("escapes the characters LaTeX reads as markup", () => {
    expect(deriveQuotationBefore("latex", "50% of a_b & #1 ~x")).toBe("``50\\% of a\\_b \\& \\#1 \\textasciitilde{}x''~");
  });

  it("quotes for Typst and escapes its markup characters", () => {
    expect(deriveQuotationBefore("typst", "uses #code and @ref")).toBe(String.raw`"uses \#code and \@ref" `);
  });
});

describe("createCitationSnippet", () => {
  it("writes a plain citation in each format", () => {
    expect(createCitationSnippet("latex", "vaswani17")).toBe("\\cite{vaswani17}");
    expect(createCitationSnippet("typst", "vaswani17")).toBe("@vaswani17");
  });

  it("adds the page as the citation's supplement", () => {
    expect(createCitationSnippet("latex", "k", { page: 4 })).toBe("\\cite[p.~4]{k}");
    expect(createCitationSnippet("typst", "k", { page: 4 })).toBe("@k[p. 4]");
  });

  it("puts the quotation before the citation", () => {
    expect(createCitationSnippet("latex", "k", { page: 4, quotation: "Attention" })).toBe("``Attention''~\\cite[p.~4]{k}");
    expect(createCitationSnippet("typst", "k", { page: 4, quotation: "Attention" })).toBe('"Attention" @k[p. 4]');
  });

  it("quotes without a page when the highlight has none", () => {
    expect(createCitationSnippet("latex", "k", { quotation: "x" })).toBe("``x''~\\cite{k}");
  });
});

const highlight = (content: string, pageNumber = 4) => ({ type: "highlight", content, pageNumber }) as unknown as Annotation;

describe("derivePaperPickText", () => {
  it("lists a paper by title, key, status and year", () => {
    const paper = { title: "T", citeKey: "k", status: "unread", year: 2020 } as unknown as PaperRecord;
    expect(derivePaperPickText(paper)).toEqual({ label: "T", description: "@k", detail: "Unread · 2020" });
  });
});

describe("renderHighlightedHtml words", () => {
  it("flattens whitespace and cuts long text", () => {
    expect(formatHighlightLabel(highlight("a \n  b"))).toBe("a b");
    expect(formatHighlightLabel(highlight("x".repeat(200)))).toBe(`${"x".repeat(120)}…`);
    expect(formatHighlightPage(highlight("a", 7))).toBe("p. 7");
  });
});

describe("deriveChoiceCitationSpec", () => {
  it("gives no options without a highlight, the page for a cite and the quotation for a quote", () => {
    const one = highlight("text", 9);
    expect(deriveChoiceCitationSpec({ quote: false })).toEqual({});
    expect(deriveChoiceCitationSpec({ highlight: one, quote: false })).toEqual({ page: 9 });
    expect(deriveChoiceCitationSpec({ highlight: one, quote: true })).toEqual({ page: 9, quotation: "text" });
  });
});

describe("findSourceHeadings", () => {
  it("reads LaTeX sections with their lines", () => {
    expect(findSourceHeadings("latex", "intro\n\\section{Method}\n\\subsection*{Data  set}")).toEqual([
      { line: 1, title: "Method" }, { line: 2, title: "Data set" },
    ]);
  });

  it("reads Typst headings without their label", () => {
    expect(findSourceHeadings("typst", "= Intro\ntext == not\n  == Related work <rel>\n=no space")).toEqual([
      { line: 0, title: "Intro" }, { line: 2, title: "Related work" },
    ]);
  });
});

describe("findCitationSites", () => {
  it("gives each LaTeX citation its line and the heading above it", () => {
    const text = "\\cite{a}\n\\section{Related}\nsee \\cite{b,c}\n\\section{Method \\cite{d}}";
    expect(findCitationSites("latex", text)).toEqual([
      { key: "a", line: 0, section: undefined },
      { key: "b", line: 2, section: "Related" },
      { key: "c", line: 2, section: "Related" },
      { key: "d", line: 3, section: "Method \\cite{d}" },
    ]);
  });

  it("places Typst references under their heading", () => {
    expect(findCitationSites("typst", "= Intro\n@a\n== Deep\n#cite(<b>)")).toEqual([
      { key: "a", line: 1, section: "Intro" },
      { key: "b", line: 3, section: "Deep" },
    ]);
  });

  it("ignores commented-out citations", () => {
    expect(findCitationSites("latex", "% \\cite{gone}\n\\cite{kept}")).toEqual([{ key: "kept", line: 1, section: undefined }]);
  });
});

const shelf = [
  { key: "vaswani2017attention", authors: ["Ashish Vaswani", "Noam Shazeer"], year: "2017" },
  { key: "devlin2019bert", authors: ["Jacob Devlin"], year: "2019" },
  { key: "he2016deep", authors: ["Kaiming He"], year: "2016" },
];

describe("deriveSuggestedCiteKey", () => {
  it.each([
    ["a typo in the surname", "vaswni2017attention", "vaswani2017attention"],
    ["a typo in the word", "devlin2019brt", "devlin2019bert"],
    ["a wrong year", "vaswani2018attention", "vaswani2017attention"],
    ["a different case", "Devlin2019BERT", "devlin2019bert"],
  ])("suggests the shelf key for %s", (_case, missing, expected) => {
    expect(deriveSuggestedCiteKey(missing, shelf)).toBe(expected);
  });

  it.each([
    ["a different author with the same year and word", "hinton2017attention"],
    ["an unrelated key", "smith2020graphs"],
    ["an empty key", ""],
  ])("suggests nothing for %s", (_case, missing) => {
    expect(deriveSuggestedCiteKey(missing, shelf)).toBeUndefined();
  });

  it("suggests nothing on an empty shelf", () => {
    expect(deriveSuggestedCiteKey("vaswani2017attention", [])).toBeUndefined();
  });

  it("prefers the key whose year matches the missing key", () => {
    const keys = [
      { key: "lecun1998gradient", authors: ["Yann LeCun"], year: "1998" },
      { key: "lecun1989gradient", authors: ["Yann LeCun"], year: "1989" },
    ];
    expect(deriveSuggestedCiteKey("lecun1989gradiet", keys)).toBe("lecun1989gradient");
  });

  it("breaks a tie by key ascending, whatever the shelf order", () => {
    const keys = [
      { key: "smith2020graphb", authors: ["Jane Smith"], year: "2020" },
      { key: "smith2020grapha", authors: ["Jane Smith"], year: "2020" },
    ];
    expect(deriveSuggestedCiteKey("smith2020graph", keys)).toBe("smith2020grapha");
    expect(deriveSuggestedCiteKey("smith2020graph", [...keys].reverse())).toBe("smith2020grapha");
  });

  it("matches a key that does not start with its first author's surname", () => {
    const keys = [{ key: "attention2017", authors: ["Ashish Vaswani"], year: "2017" }];
    expect(deriveSuggestedCiteKey("attenton2017", keys)).toBe("attention2017");
    expect(deriveSuggestedCiteKey("vaswani2017", keys)).toBeUndefined();
  });
});
