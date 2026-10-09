/** Contract of reading a stored record as metadata: what the record states, nothing it does not. */
import { metadataFromRecord } from "@labshelf/core";
import type { PaperRecord } from "@labshelf/core";

const record = (over: Partial<PaperRecord> = {}): PaperRecord => ({ id: "x", title: "A title", citeKey: "x", path: "papers/x", status: "unread", ...over });

describe("metadataFromRecord", () => {
  it("carries the bibliographic fields the record states", () => {
    expect(metadataFromRecord(record({
      authors: ["Ada Lovelace"], year: 2023, journal: "J", doi: "10.1/x", url: "https://pub.example/a", keywords: ["k"],
    }))).toEqual({ title: "A title", authors: ["Ada Lovelace"], year: 2023, journal: "J", doi: "10.1/x", url: "https://pub.example/a", keywords: ["k"] });
  });

  it("leaves out fields the record lacks and the library's own bookkeeping", () => {
    expect(metadataFromRecord(record({ tags: ["t"], note: "n", hasPdf: false }))).toEqual({ title: "A title" });
  });
});
