import { escapeHtml } from "../../src/ui/escapeHtml";

describe("escapeHtml", () => {
  it("escapes ampersand, angle brackets and both quote kinds", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand of an existing entity", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("returns an empty string for null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("stringifies other values", () => {
    expect(escapeHtml(2017)).toBe("2017");
    expect(escapeHtml(0)).toBe("0");
  });
});
