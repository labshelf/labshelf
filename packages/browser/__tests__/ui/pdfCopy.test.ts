import { pdfLineText } from "../../src/ui/pdfCopy";
import type { PdfMiss } from "@labshelf/core";

const miss = (over: Partial<PdfMiss> = {}): PdfMiss => ({ tried: 0, sources: [], blocked: false, needsLogin: false, ...over });

describe("pdfLineText", () => {
  it("reads while searching, when found and when the search ends empty", () => {
    expect(pdfLineText("searching")).toBe("Looking for the PDF…");
    expect(pdfLineText({ found: true, source: "publisher" })).toBe("PDF found · the publisher");
    expect(pdfLineText({ found: false, miss: miss({ tried: 3, sources: ["page"] }) }))
      .toBe("No PDF found (tried 3 links) — you'll be asked before saving");
    expect(pdfLineText({ found: false, miss: miss({ tried: 1 }) }))
      .toBe("No PDF found (tried 1 link) — you'll be asked before saving");
    expect(pdfLineText({ found: false })).toBe("No PDF found — you'll be asked before saving");
  });
});
