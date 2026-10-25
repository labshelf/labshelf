/** Verifies how pdf.js text items become lines: an item flagged hasEOL ends its line. */
import { derivePdfTextLines } from "../../../src/writing/checks/index";

describe("derivePdfTextLines", () => {
  it("joins the pieces of a line and ends it at an item flagged hasEOL", () => {
    const items = [{ str: "Hello " }, { str: "world", hasEOL: true }, { str: "Second", hasEOL: true }];
    expect(derivePdfTextLines(items)).toEqual(["Hello world", "Second"]);
  });

  it("keeps a trailing line that has no end-of-line item", () => {
    expect(derivePdfTextLines([{ str: "a", hasEOL: true }, { str: "b" }, { str: "c" }])).toEqual(["a", "bc"]);
  });

  it("keeps empty lines made by an empty hasEOL item and treats a missing str as empty", () => {
    expect(derivePdfTextLines([{ str: "a", hasEOL: true }, { hasEOL: true }, { str: "b", hasEOL: true }])).toEqual(["a", "", "b"]);
  });

  it("returns no lines for no items", () => {
    expect(derivePdfTextLines([])).toEqual([]);
  });
});
