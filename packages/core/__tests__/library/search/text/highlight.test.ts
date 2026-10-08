import { highlightRanges } from "@labshelf/core";

const marked = (text: string, terms: string[]): string[] => highlightRanges(text, terms).map(([a, b]) => text.slice(a, b));

describe("highlightRanges", () => {
  it("finds every case-insensitive occurrence of each term", () => {
    expect(highlightRanges("Attention is all", ["att", "all"])).toEqual([[0, 3], [13, 16]]);
    expect(marked("an bn an", ["an"])).toEqual(["an", "an"]);
  });

  it("marks accented text for an unaccented term", () => {
    expect(marked("Café Müller", ["cafe", "muller"])).toEqual(["Café", "Müller"]);
  });

  it("marks accented text for an accented term", () => {
    expect(marked("Cafe", ["café"])).toEqual(["Cafe"]);
  });

  it("keeps a combining mark with its letter in decomposed text", () => {
    const text = "Café au lait";
    expect(marked(text, ["cafe"])).toEqual(["Café"]);
  });

  it("merges overlapping and touching ranges", () => {
    expect(marked("abcdef", ["abc", "bcd"])).toEqual(["abcd"]);
    expect(marked("abcdef", ["abc", "def"])).toEqual(["abcdef"]);
  });

  it("returns nothing for no terms, empty terms or no match", () => {
    expect(highlightRanges("a & b", [])).toEqual([]);
    expect(highlightRanges("a & b", [""])).toEqual([]);
    expect(highlightRanges("a & b", ["zzz"])).toEqual([]);
  });

  it("reports positions in the original text across characters that fold away", () => {
    expect(highlightRanges("ÀÉ x", ["x"])).toEqual([[3, 4]]);
  });
});
