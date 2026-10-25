/** Verifies where a key is typed and where keys are cited in LaTeX and Typst text. */
import { findCiteKeyOccurrences, partialKeyStart } from "../../../src/writing/citations/index";

describe("partialKeyStart in LaTeX", () => {
  it.each([
    ["\\cite{", 6],
    ["See \\citep{vasw", 11],
    ["\\cite[p. 3]{a, b", 15],
    ["\\textcite*[see][p. 3]{a,  b", 26],
    ["\\autocite{a,", 12],
  ])("starts the partial key of %j at column %i", (prefix, column) => {
    expect(partialKeyStart("latex", prefix)).toBe(column);
  });

  it.each(["\\cite{a}", "\\cite{a} and ", "\\section{", "{", "\\cite", "plain text, more"])(
    "is outside a cite for %j", (prefix) => {
      expect(partialKeyStart("latex", prefix)).toBeUndefined();
    },
  );
});

describe("partialKeyStart in Typst", () => {
  it.each([
    ["see @", 5],
    ["see @vasw", 5],
    ["(@a, @he20", 6],
    ["#cite(<", 7],
    ["#cite( <he20", 8],
  ])("starts the partial key of %j at column %i", (prefix, column) => {
    expect(partialKeyStart("typst", prefix)).toBe(column);
  });

  it.each(["mail me@home", "a <b", "plain text", "#cite(<a>", "x_@"])("is outside a reference for %j", (prefix) => {
    expect(partialKeyStart("typst", prefix)).toBeUndefined();
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
