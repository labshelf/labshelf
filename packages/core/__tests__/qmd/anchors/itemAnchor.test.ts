import { formatAnchor, parseAnchor, type ItemAnchor } from "../../../src/qmd/anchors/index";

describe("itemAnchor", () => {
  it.each<[string, ItemAnchor]>([
    ["hl:3f1c2a9e-8b7d-4c1e-9a2b-5d6e7f809a1b", { kind: "highlight", annotationId: "3f1c2a9e-8b7d-4c1e-9a2b-5d6e7f809a1b" }],
    ["p10 box 0.12 0.4 0.3 0.1", { kind: "box", page: 10, x: 0.12, y: 0.4, w: 0.3, h: 0.1 }],
    ["p1 box 0 0 1 1", { kind: "box", page: 1, x: 0, y: 0, w: 1, h: 1 }],
  ])("parses and writes %s", (text, anchor) => {
    expect(parseAnchor(text)).toEqual(anchor);
    expect(formatAnchor(anchor)).toBe(text);
  });

  it("reads absent and empty as no anchor", () => {
    expect(parseAnchor(undefined)).toEqual({ kind: "none" });
    expect(parseAnchor("")).toEqual({ kind: "none" });
    expect(formatAnchor({ kind: "none" })).toBe("");
  });

  it("round-trips a quote with non-ASCII text", () => {
    const anchor: ItemAnchor = { kind: "quote", quote: "a strong baseline ∀ε", prefix: "We compare \"against\" ", suffix: "" };
    const text = formatAnchor(anchor);
    expect(text).toMatch(/^quote:[A-Za-z0-9_-]+$/);
    expect(parseAnchor(text)).toEqual(anchor);
  });

  it("rounds box fractions to 4 decimals when writing", () => {
    expect(formatAnchor({ kind: "box", page: 2, x: 0.123456, y: 0.5, w: 0.25, h: 0.00004 + 0.1 })).toBe("p2 box 0.1235 0.5 0.25 0.1");
  });

  it.each([
    "p0 box 0.1 0.1 0.1 0.1",
    "p1 box 0.1 0.1 0.1",
    "p1 box 0.12345 0.1 0.1 0.1",
    "p1 box 0.1 0.1 0 0.1",
    "p1 box 0.8 0.1 0.3 0.1",
    "p1 box 1.5 0 0.1 0.1",
    "p1  box 0.1 0.1 0.1 0.1",
    "p1 box -0.1 0.1 0.1 0.1",
    "quote:not*base64",
    `quote:${Buffer.from(JSON.stringify({ quote: "", prefix: "", suffix: "" })).toString("base64url")}`,
    `quote:${Buffer.from(JSON.stringify({ quote: "q", prefix: "x".repeat(33), suffix: "" })).toString("base64url")}`,
    `quote:${Buffer.from("[1,2]").toString("base64url")}`,
    "hl:",
    "somewhere new",
  ])("keeps a malformed anchor verbatim: %s", (text) => {
    expect(parseAnchor(text)).toEqual({ kind: "unknown", raw: text });
    expect(formatAnchor({ kind: "unknown", raw: text })).toBe(text);
  });

  it("refuses to write an invalid anchor", () => {
    expect(() => formatAnchor({ kind: "box", page: 0, x: 0, y: 0, w: 0.1, h: 0.1 })).toThrow(/box/);
    expect(() => formatAnchor({ kind: "box", page: 1, x: 0.95, y: 0, w: 0.1, h: 0.1 })).toThrow(/box/);
    expect(() => formatAnchor({ kind: "quote", quote: "", prefix: "", suffix: "" })).toThrow(/quote/);
    expect(() => formatAnchor({ kind: "highlight", annotationId: "has space" })).toThrow(/annotation/);
  });
});
