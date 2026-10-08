import { esc, highlight } from "../../src/ui/dom";

describe("esc", () => {
  it("escapes HTML metacharacters and stringifies nullish values", () => {
    expect(esc(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
    expect(esc(null)).toBe("");
    expect(esc(2017)).toBe("2017");
  });
});

describe("highlight", () => {
  it("wraps every case-insensitive token match in <mark> and escapes the rest", () => {
    expect(highlight("Attention <is> all", ["att", "all"])).toBe("<mark>Att</mark>ention &lt;is&gt; <mark>all</mark>");
  });
  it("merges overlapping matches into one mark", () => {
    expect(highlight("abcdef", ["abc", "bcd"])).toBe("<mark>abcd</mark>ef");
  });
  it("marks accented text for an unaccented term", () => {
    expect(highlight("Café <Müller>", ["cafe", "muller"])).toBe("<mark>Café</mark> &lt;<mark>Müller</mark>&gt;");
  });
  it("returns escaped text when nothing matches or there are no tokens", () => {
    expect(highlight("a & b", [])).toBe("a &amp; b");
    expect(highlight("a & b", ["zzz"])).toBe("a &amp; b");
  });
});
