import type { Annotation } from "../../../src/model";
import { paperDetailsOf, paperStatsOf } from "../../../src/library-ui/derive/sidecarSummary";

const annotation = { id: "a1" } as Annotation;

describe("sidecar summary", () => {
  it("counts annotations and carries the reading position into the stats", () => {
    const reading = { page: 7, updatedAt: "2026-01-02T03:04:05.000Z" };
    expect(paperStatsOf({ annotations: [annotation, annotation], reading })).toEqual({
      annotations: 2, lastPage: 7, lastRead: reading.updatedAt,
    });
  });

  it("leaves the reading fields out of the stats of a paper never opened", () => {
    expect(paperStatsOf({ annotations: [] })).toEqual({ annotations: 0 });
  });

  it("shows no reading position in the details of a paper never opened", () => {
    const pdf = { size: 10, relPath: "a/paper.pdf" };
    expect(paperDetailsOf({ annotations: [annotation] }, pdf)).toEqual({ annotations: [annotation], reading: null, pdf });
  });

  it("copies the reading position and the PDF into the details", () => {
    const reading = { page: 3, updatedAt: "2026-02-01T00:00:00.000Z" };
    expect(paperDetailsOf({ annotations: [], reading }, null)).toEqual({ annotations: [], reading, pdf: null });
  });

  describe("lastHighlight", () => {
    const hl = (id: string, pageNumber: number, content: string, updatedAt: string, type: Annotation["type"] = "highlight") =>
      ({ id, type, pageNumber, content, updatedAt }) as Annotation;

    it("takes the highlight changed last, with its 1-based page and text", () => {
      const annotations = [hl("a", 2, "early", "2026-01-01T00:00:00.000Z"), hl("b", 5, "late", "2026-03-01T00:00:00.000Z"), hl("c", 9, "mid", "2026-02-01T00:00:00.000Z")];
      expect(paperStatsOf({ annotations }).lastHighlight).toEqual({ page: 5, text: "late" });
    });

    it("lets the later highlight in sidecar order win a tie", () => {
      const at = "2026-01-01T00:00:00.000Z";
      expect(paperStatsOf({ annotations: [hl("a", 1, "first", at), hl("b", 4, "second", at)] }).lastHighlight).toEqual({ page: 4, text: "second" });
    });

    it("ignores annotations that are not highlights", () => {
      const annotations = [hl("a", 1, "kept", "2026-01-01T00:00:00.000Z"), hl("n", 3, "note", "2027-01-01T00:00:00.000Z", "note"), hl("c", 3, "c", "2027-01-01T00:00:00.000Z", "comment")];
      expect(paperStatsOf({ annotations }).lastHighlight).toEqual({ page: 1, text: "kept" });
    });

    it("leaves lastHighlight out when there is no highlight", () => {
      expect(paperStatsOf({ annotations: [hl("n", 3, "note", "2026-01-01T00:00:00.000Z", "note")] })).toEqual({ annotations: 1 });
    });
  });
});
