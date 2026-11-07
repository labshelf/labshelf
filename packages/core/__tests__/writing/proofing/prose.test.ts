import { findProseRanges, type ProseRange } from "../../../src/writing/proofing/index.js";

function prose(format: "latex" | "typst", text: string): string {
  return findProseRanges(format, text).map((range) => text.slice(range.from, range.to)).join("|");
}

function intersect(ranges: readonly ProseRange[], from: number, to: number): ProseRange[] {
  return ranges
    .map((range) => ({ from: Math.max(range.from, from), to: Math.min(range.to, to) }))
    .filter((range) => range.to > range.from);
}

const LATEX = [
  "\\documentclass[12pt]{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\begin{document}",
  "\\section{Introduction heading}",
  "Body text % a hidden comment",
  "with $inline math$ and \\[ display math \\] here.",
  "\\begin{equation} equation body \\end{equation}",
  "\\begin{align} align body \\end{align}",
  "See \\cite[p.~3]{citekey} and \\ref{figref} \\label{seclabel}.",
  "Visit \\url{http://example.org/urlpath}.",
  "\\begin{verbatim}",
  "verbatim body",
  "\\end{verbatim}",
  "\\foreignlanguage{english}{foreign words}",
  "\\textenglish{english words}",
  "\\begin{otherlanguage}{english}other body\\end{otherlanguage}",
  "\\emph{emphasised words} \\caption{caption words} \\footnote{footnote words}",
  "\\href{http://example.org/hrefpath}{link words}",
  "\\end{document}",
].join("\n");

describe("findProseRanges, LaTeX", () => {
  const text = prose("latex", LATEX);

  it.each([
    "hidden comment", "inline math", "display math", "equation body", "align body", "citekey", "p.~3", "figref",
    "seclabel", "urlpath", "verbatim body", "foreign words", "english words", "other body", "hrefpath",
    "article", "inputenc", "utf8", "12pt", "document", "section",
  ])("leaves %s out of the prose", (fragment) => {
    expect(text).not.toContain(fragment);
  });

  it("leaves command names out of the prose", () => {
    expect(text).not.toMatch(/\b(?:emph|href|begin|end)\b|footnote\{|caption\{/);
  });

  it.each([
    "Introduction heading", "Body text", "emphasised words", "caption words", "footnote words", "link words", "here.", "See",
  ])("keeps %s as prose", (fragment) => {
    expect(text).toContain(fragment);
  });

  it("returns sorted, non-overlapping ranges", () => {
    const ranges = findProseRanges("latex", LATEX);
    for (let k = 1; k < ranges.length; k++) expect(ranges[k]!.from).toBeGreaterThan(ranges[k - 1]!.to);
  });

  it("skips inline verbatim, key=value options and command definitions", () => {
    const sample = "A \\verb|code here| b \\includegraphics[width=3cm]{figfile} \\newcommand{\\foo}[1]{defbody} c";
    const out = prose("latex", sample);
    expect(out).not.toMatch(/code here|figfile|width|defbody|foo/);
    expect(out).toContain("A ");
    expect(out).toContain(" c");
  });
});

const TYPST = [
  '#set text(lang: "pt")',
  "= Heading words",
  "Body text // a hidden comment",
  "with $inline math$ and `raw code` here.",
  "/* block",
  "comment */",
  '#figure(image("figfile.png"), caption: [Figure caption words]) <figlabel>',
  "See @figref and #emph[emphasised words].",
  "#let value = 3",
  "Last line.",
].join("\n");

describe("findProseRanges, Typst", () => {
  const text = prose("typst", TYPST);

  it.each([
    "lang", '"pt"', "set", "hidden comment", "inline math", "raw code", "block", "figfile", "figure", "figlabel",
    "figref", "value",
  ])("leaves %s out of the prose", (fragment) => {
    expect(text).not.toContain(fragment);
  });

  it("leaves code names out of the prose", () => {
    expect(text).not.toMatch(/\b(?:emph|caption:|image|let)\b/);
  });

  it.each(["Heading words", "Body text", "here.", "emphasised words", "Figure caption words", "See", "Last line."])(
    "keeps %s as prose",
    (fragment) => {
      expect(text).toContain(fragment);
    },
  );

  it("ends a #set line at its line end unless a bracket is open", () => {
    const sample = "#set page(\n  margin: 2cm,\n)\nAfter words.";
    expect(prose("typst", sample)).not.toContain("margin");
    expect(prose("typst", sample)).toContain("After words.");
  });
});

describe("findProseRanges, window", () => {
  const verbatimDoc = "Start words.\n\\begin{verbatim}\ninside one\ninside two\n\\end{verbatim}\nAfter words.\n";
  const cases: Array<[string, "latex" | "typst", string]> = [
    ["latex", "latex", LATEX],
    ["typst", "typst", TYPST],
    ["latex verbatim", "latex", verbatimDoc],
  ];

  it.each(cases)("matches the full scan intersected with the window (%s)", (_name, format, doc) => {
    const full = findProseRanges(format, doc);
    for (let from = 0; from < doc.length; from += 7) {
      for (const width of [1, 13, 40, doc.length]) {
        const to = Math.min(doc.length, from + width);
        expect(findProseRanges(format, doc, from, to)).toEqual(intersect(full, from, to));
      }
    }
  });

  it("gives no prose for a window that starts inside a verbatim environment", () => {
    const from = verbatimDoc.indexOf("one");
    const to = verbatimDoc.indexOf("\\end");
    expect(findProseRanges("latex", verbatimDoc, from, to)).toEqual([]);
  });
});
