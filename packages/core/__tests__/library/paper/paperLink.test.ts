/** Verifies the labshelf: link grammar shared by every app. */
import { findLabshelfLinks, formatLabshelfLink, parseLabshelfLink } from "../../../src/library/index";

describe("parseLabshelfLink", () => {
  it("reads a key with and without a page", () => {
    expect(parseLabshelfLink("labshelf:vaswani2017#p5")).toEqual({ citeKey: "vaswani2017", page: 5 });
    expect(parseLabshelfLink("labshelf:vaswani2017")).toEqual({ citeKey: "vaswani2017" });
  });

  it("reads the web+labshelf form, percent-encoded as a protocol handler passes it", () => {
    expect(parseLabshelfLink("web%2Blabshelf%3Avaswani2017%23p5")).toEqual({ citeKey: "vaswani2017", page: 5 });
    expect(parseLabshelfLink("web+labshelf:Smith_2020:ml.v2")).toEqual({ citeKey: "Smith_2020:ml.v2" });
  });

  it("rejects anything that is not exactly one link", () => {
    for (const text of ["", "labshelf:", "labshelf:a#p0", "labshelf:a#pX", "see labshelf:a", "labshelf:a b", "%E0%A4%A", "xlabshelf:a"]) {
      expect(parseLabshelfLink(text)).toBeUndefined();
    }
  });

  it("round-trips through formatLabshelfLink", () => {
    for (const link of [{ citeKey: "a-b.c" }, { citeKey: "k", page: 12 }]) {
      expect(parseLabshelfLink(formatLabshelfLink(link))).toEqual(link);
    }
  });
});

describe("findLabshelfLinks", () => {
  it("finds links in a code comment with their ranges", () => {
    const text = "x = 1  # see labshelf:vaswani2017#p5 and labshelf:he2016.";
    const found = findLabshelfLinks(text);
    expect(found.map((m) => text.slice(m.start, m.end))).toEqual(["labshelf:vaswani2017#p5", "labshelf:he2016"]);
    expect(found.map((m) => m.link)).toEqual([{ citeKey: "vaswani2017", page: 5 }, { citeKey: "he2016" }]);
  });

  it("ignores scheme-like words glued to other text", () => {
    expect(findLabshelfLinks("mylabshelf:a foo+labshelf:b")).toEqual([]);
  });

  it("returns nothing for text without the scheme", () => {
    expect(findLabshelfLinks("no links here")).toEqual([]);
  });
});
