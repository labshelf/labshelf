import type { Annotation } from "@labshelf/core";
import { syncReasonFor } from "../../src/reader/readerSyncReason";

const annotation = { id: "a1" } as Annotation;

describe("syncReasonFor", () => {
  it("names theme changes and every annotation change", () => {
    expect(syncReasonFor({ kind: "theme" })).toBe("reader.theme");
    expect(syncReasonFor({ kind: "annotationCreated", annotation })).toBe("reader.annotation");
    expect(syncReasonFor({ kind: "annotationUpdated", annotation })).toBe("reader.annotation");
    expect(syncReasonFor({ kind: "annotationDeleted", annotationId: "a1" })).toBe("reader.annotation");
  });
});
