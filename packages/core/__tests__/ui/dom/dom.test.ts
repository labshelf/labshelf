/**
 * Tests the DOM helpers that mark search matches in rendered text.
 */
import { renderHighlightedHtml } from "../../../src/ui/dom/dom";

describe("renderHighlightedHtml", () => {
  it("wraps every case-insensitive token match in <mark> and escapes the rest", () => {
    expect(renderHighlightedHtml("Attention <is> all", ["att", "all"])).toBe("<mark>Att</mark>ention &lt;is&gt; <mark>all</mark>");
  });
  it("merges overlapping matches into one mark", () => {
    expect(renderHighlightedHtml("abcdef", ["abc", "bcd"])).toBe("<mark>abcd</mark>ef");
  });
  it("marks accented text for an unaccented term", () => {
    expect(renderHighlightedHtml("Café <Müller>", ["cafe", "muller"])).toBe("<mark>Café</mark> &lt;<mark>Müller</mark>&gt;");
  });
  it("returns escaped text when nothing matches or there are no tokens", () => {
    expect(renderHighlightedHtml("a & b", [])).toBe("a &amp; b");
    expect(renderHighlightedHtml("a & b", ["zzz"])).toBe("a &amp; b");
  });
});
