/**
 * Tests the DOM helpers that mark search matches in rendered text.
 */
import { highlight } from "../../../src/ui/dom/dom";

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
