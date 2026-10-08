jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

import type { PaperRecord } from "@labshelf/core";
import { draftFromRecord } from "../../src/capture/recordCapture";

const rec = (over: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id: "x", title: "T", citeKey: "x", path: "papers/x", status: "unread", ...over });

describe("draftFromRecord", () => {
  it("builds a search draft from the record's ids with no landing fetch when there is no url", async () => {
    const r = rec({ doi: "10.1000/xyz123" });
    const draft = await draftFromRecord(r);
    expect(draft.ids).toEqual({ doi: "10.1000/xyz123" });
    expect(draft.pageUrl).toBe("");
    expect(draft.pdfCandidates).toEqual([]);
    expect(draft.pdfAttempts).toEqual([]);
    expect(draft.isPaper).toBe(true);
    expect(draft.existing).toBe(r);
  });
});
