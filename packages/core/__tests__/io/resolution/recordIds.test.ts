import type { PaperRecord } from "@labshelf/core";
import { idsFromRecord } from "@labshelf/core";

const rec = (over: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id: "x", title: "T", citeKey: "x", path: "papers/x", status: "unread", ...over });

describe("idsFromRecord", () => {
  it("reads the arXiv id from an arXiv DOI (and keeps the DOI)", () => {
    expect(idsFromRecord(rec({ doi: "10.48550/arXiv.2301.12345" })))
      .toEqual({ doi: "10.48550/arXiv.2301.12345", arxivId: "2301.12345" });
  });

  it("reads the arXiv id from an arxiv.org URL when there is no DOI", () => {
    expect(idsFromRecord(rec({ url: "https://arxiv.org/abs/2301.12345" }))).toEqual({ arxivId: "2301.12345" });
  });

  it("reads a PMID from a PubMed URL", () => {
    expect(idsFromRecord(rec({ url: "https://pubmed.ncbi.nlm.nih.gov/32015508" }))).toEqual({ pmid: "32015508" });
  });

  it("reads a plain DOI, and combines a DOI with a PubMed URL", () => {
    expect(idsFromRecord(rec({ doi: "10.1000/xyz123" }))).toEqual({ doi: "10.1000/xyz123" });
    expect(idsFromRecord(rec({ doi: "10.1000/xyz", url: "https://pubmed.ncbi.nlm.nih.gov/123456" })))
      .toEqual({ doi: "10.1000/xyz", pmid: "123456" });
  });

  it("returns an empty object when the record names no identifier", () => {
    expect(idsFromRecord(rec({ url: "https://example.com/some-article" }))).toEqual({});
  });
});
