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
});
