/** Verifies the labshelf: link grammar shared by every app. */
import { findPaperLinkMatches, formatPaperLink, parsePaperLink } from "../../../src/library/index";

describe("parseLabshelfLink", () => {
  it("reads a key with and without a page", () => {
    expect(parsePaperLink("labshelf:vaswani2017#p5")).toEqual({ citeKey: "vaswani2017", page: 5 });
    expect(parsePaperLink("labshelf:vaswani2017")).toEqual({ citeKey: "vaswani2017" });
  });

  it("reads the web+labshelf form, percent-encoded as a protocol handler passes it", () => {
    expect(parsePaperLink("web%2Blabshelf%3Avaswani2017%23p5")).toEqual({ citeKey: "vaswani2017", page: 5 });
    expect(parsePaperLink("web+labshelf:Smith_2020:ml.v2")).toEqual({ citeKey: "Smith_2020:ml.v2" });
  });

  it("rejects anything that is not exactly one link", () => {
    for (const text of ["", "labshelf:", "labshelf:a#p0", "labshelf:a#pX", "see labshelf:a", "labshelf:a b", "%E0%A4%A", "xlabshelf:a"]) {
      expect(parsePaperLink(text)).toBeUndefined();
    }
  });

  it("round-trips through formatLabshelfLink", () => {
    for (const link of [{ citeKey: "a-b.c" }, { citeKey: "k", page: 12 }]) {
      expect(parsePaperLink(formatPaperLink(link))).toEqual(link);
    }
  });
});

describe("paper links with a box", () => {
  it("reads a page region and round-trips it", () => {
    const link = { citeKey: "vaswani2017", page: 4, box: { x: 0.1, y: 0.25, w: 0.8, h: 0.125 } };
    expect(formatPaperLink(link)).toBe("labshelf:vaswani2017#p4:0.1,0.25,0.8,0.125");
    expect(parsePaperLink(formatPaperLink(link))).toEqual(link);
    expect(parsePaperLink("labshelf:k#p2:0,0,1,1")).toEqual({ citeKey: "k", page: 2, box: { x: 0, y: 0, w: 1, h: 1 } });
  });

  it("writes at most four decimals", () => {
    expect(formatPaperLink({ citeKey: "k", page: 1, box: { x: 0.123456, y: 0.5, w: 0.33333, h: 0.1 } })).toBe("labshelf:k#p1:0.1235,0.5,0.3333,0.1");
  });

  it("rejects a box outside the page or with too many decimals", () => {
    for (const text of ["labshelf:k#p1:0.5,0,0.6,0.1", "labshelf:k#p1:0,0.95,0.5,0.1", "labshelf:k#p1:0,0,0,0.5", "labshelf:k#p1:1,0,0.1,0.1", "labshelf:k#p1:0.12345,0,0.1,0.1"]) {
      expect(parsePaperLink(text)).toBeUndefined();
    }
  });

  it("finds a boxed link in prose without the full stop after it", () => {
    const text = "See labshelf:k#p3:0.1,0.2,0.3,0.4. Then more.";
    const [found] = findPaperLinkMatches(text);
    expect(text.slice(found!.start, found!.end)).toBe("labshelf:k#p3:0.1,0.2,0.3,0.4");
    expect(found!.link).toEqual({ citeKey: "k", page: 3, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
  });
});

describe("findLabshelfLinks", () => {
  it("finds links in a code comment with their ranges", () => {
    const text = "x = 1  # see labshelf:vaswani2017#p5 and labshelf:he2016.";
    const found = findPaperLinkMatches(text);
    expect(found.map((m) => text.slice(m.start, m.end))).toEqual(["labshelf:vaswani2017#p5", "labshelf:he2016"]);
    expect(found.map((m) => m.link)).toEqual([{ citeKey: "vaswani2017", page: 5 }, { citeKey: "he2016" }]);
  });

  it("ignores scheme-like words glued to other text", () => {
    expect(findPaperLinkMatches("mylabshelf:a foo+labshelf:b")).toEqual([]);
  });

  it("returns nothing for text without the scheme", () => {
    expect(findPaperLinkMatches("no links here")).toEqual([]);
  });
});
