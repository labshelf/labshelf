import { deriveFuzzyScore, orderFuzzy } from "@labshelf/core";

describe("fuzzyScore", () => {
  it("matches a subsequence of the text", () => {
    expect(deriveFuzzyScore("atn", "Attention Is All You Need")).toBeDefined();
  });

  it("returns undefined when the pattern is not a subsequence of the text", () => {
    expect(deriveFuzzyScore("xyz", "abc")).toBeUndefined();
    expect(deriveFuzzyScore("ba", "ab")).toBeUndefined();
    expect(deriveFuzzyScore("aab", "ab")).toBeUndefined();
  });

  it("matches everything, with score 0, for an empty or blank pattern", () => {
    expect(deriveFuzzyScore("", "anything")).toEqual({ score: 0 });
    expect(deriveFuzzyScore("   ", "anything")).toEqual({ score: 0 });
  });

  it("ignores case, accents and spaces in the pattern", () => {
    expect(deriveFuzzyScore("SCH", "Schrödinger")).toBeDefined();
    expect(deriveFuzzyScore("schrod", "Schrödinger")).toBeDefined();
    expect(deriveFuzzyScore("a t n", "Attention")).toEqual(deriveFuzzyScore("atn", "Attention"));
  });

  it("scores consecutive matches above scattered ones", () => {
    expect(deriveFuzzyScore("abc", "xabcxx")!.score).toBeGreaterThan(deriveFuzzyScore("abc", "xaxbxc")!.score);
  });

  it("scores matches at word starts above matches inside words", () => {
    expect(deriveFuzzyScore("ml", "machine learning")!.score).toBeGreaterThan(deriveFuzzyScore("ml", "animal")!.score);
    expect(deriveFuzzyScore("ml", "machine-learning")!.score).toBeGreaterThan(deriveFuzzyScore("ml", "animal")!.score);
  });

  it("prefers a shorter text and an earlier first match", () => {
    expect(deriveFuzzyScore("ab", "ab")!.score).toBeGreaterThan(deriveFuzzyScore("ab", "ab and a lot of other words")!.score);
    expect(deriveFuzzyScore("ab", "abxxxx")!.score).toBeGreaterThan(deriveFuzzyScore("ab", "xxxxab")!.score);
  });
});

describe("rankFuzzy", () => {
  const label = (s: string): string => s;

  it("puts the word-start match first: atn finds Attention before Data anonymisation", () => {
    const items = ["Data anonymisation", "Attention Is All You Need", "Graph networks"];
    expect(orderFuzzy(items, "atn", label)[0]).toBe("Attention Is All You Need");
  });

  it("drops items whose label is not a match", () => {
    expect(orderFuzzy(["Attention", "Graph", "Vision"], "atn", label)).toEqual(["Attention"]);
    expect(orderFuzzy(["Attention"], "zzz", label)).toEqual([]);
  });

  it("orders consecutive matches before scattered ones", () => {
    const items = ["xaxbxc", "xabcxx"];
    expect(orderFuzzy(items, "abc", label)).toEqual(["xabcxx", "xaxbxc"]);
  });

  it("keeps the input order for an empty or blank pattern, as a copy", () => {
    const items = ["b", "a", "c"];
    const empty = orderFuzzy(items, "", label);
    expect(empty).toEqual(["b", "a", "c"]);
    expect(empty).not.toBe(items);
    expect(orderFuzzy(items, "   ", label)).toEqual(["b", "a", "c"]);
  });

  it("keeps the input order between equal scores", () => {
    expect(orderFuzzy(["ab-1", "ab-2", "ab-3"], "ab", label)).toEqual(["ab-1", "ab-2", "ab-3"]);
  });

  it("ranks arbitrary items through the label function", () => {
    const items = [{ id: 1, name: "Computer Vision" }, { id: 2, name: "Natural Language Processing" }];
    expect(orderFuzzy(items, "nlp", (i) => i.name).map((i) => i.id)).toEqual([2]);
    expect(orderFuzzy(items, "cv", (i) => i.name).map((i) => i.id)).toEqual([1]);
  });
});
