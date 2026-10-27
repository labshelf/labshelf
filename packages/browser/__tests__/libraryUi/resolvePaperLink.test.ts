import type { PaperRecord } from "@labshelf/core";
import { resolvePaperLink } from "../../src/libraryUi/paperLink";

const paper = (id: string, citeKey: string): PaperRecord => ({ id, citeKey }) as PaperRecord;
const library = [paper("b-id", "vaswani2017"), paper("a-id", "vaswani2017"), paper("c-id", "devlin2019")];

describe("resolvePaperLink", () => {
  it("resolves a key and a page to the paper id", () => {
    expect(resolvePaperLink("web+labshelf:devlin2019#p5", library)).toEqual({ ok: true, paperId: "c-id", page: 5 });
  });
  it("leaves the page out when the link has none", () => {
    expect(resolvePaperLink("labshelf:devlin2019", library)).toEqual({ ok: true, paperId: "c-id" });
  });
  it("accepts the link percent-encoded once, as a protocol handler passes it", () => {
    expect(resolvePaperLink("web%2Blabshelf%3Adevlin2019%23p5", library)).toEqual({ ok: true, paperId: "c-id", page: 5 });
  });
  it("picks the smallest id when two papers share a key", () => {
    expect(resolvePaperLink("web+labshelf:vaswani2017", library)).toMatchObject({ ok: true, paperId: "a-id" });
  });
  it("names the missing key", () => {
    const result = resolvePaperLink("web+labshelf:nobody1999", library);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("nobody1999") });
  });
  it("rejects text that is not a whole link", () => {
    for (const text of ["", "https://example.com", "see web+labshelf:devlin2019", "web+labshelf:"]) {
      expect(resolvePaperLink(text, library)).toMatchObject({ ok: false });
    }
  });
});
