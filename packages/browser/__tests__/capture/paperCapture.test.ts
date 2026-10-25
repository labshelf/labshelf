jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

import type { ILogger, PaperRecord } from "@labshelf/core";
import { draftFromRecord } from "../../src/capture/paperCapture";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const rec = (over: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id: "x", title: "T", citeKey: "x", path: "papers/x", status: "unread", ...over });

describe("draftFromRecord", () => {
  it("builds a search draft from the record's ids with no landing fetch when there is no url", async () => {
    const r = rec({ doi: "10.1000/xyz123" });
    const draft = await draftFromRecord(log, r);
    expect(draft.ids).toEqual({ doi: "10.1000/xyz123" });
    expect(draft.pageUrl).toBe("");
    expect(draft.pdfCandidates).toEqual([]);
    expect(draft.pdfAttempts).toEqual([]);
    expect(draft.isPaper).toBe(true);
    expect(draft.existing).toBe(r);
  });

  it("carries the record's title, authors and year, so a suggested copy can be checked against them", async () => {
    const draft = await draftFromRecord(log, rec({ title: "Attention is all you need", authors: ["Ashish Vaswani"], year: 2017, doi: "10.1000/xyz123" }));
    expect(draft.metadata).toEqual({ title: "Attention is all you need", authors: ["Ashish Vaswani"], year: 2017, doi: "10.1000/xyz123" });
  });
});
