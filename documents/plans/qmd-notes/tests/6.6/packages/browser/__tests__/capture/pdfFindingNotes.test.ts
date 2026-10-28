/** The popup note becomes the first item of the captured paper's notes.qmd, written through the notes store after the paper exists. */
import type { ILogger, ImportedPaper, PaperRecord, PdfFetchOptions, PdfSearch, ResolvedPdf } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/records", () => ({ ...jest.requireActual("../../src/storage/records"), listCachedPaperRecords: async () => [], writeCachedPaperRecord: async () => undefined }));

const mockSettings = { customResolvers: [], contactEmail: "me@uni.edu", lastFolder: "papers/Thesis" };
jest.mock("../../src/platform/settings", () => ({ readSettings: async () => mockSettings, updateSettings: async () => undefined }));

let mockPdf: ResolvedPdf | undefined;
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  findPaperPdf: async (_opts: PdfFetchOptions, _search: PdfSearch, attempts: unknown[]) => {
    attempts.push({ source: "page", url: "https://pub.example/a.pdf", outcome: "html", status: 200 });
    return mockPdf;
  },
}));

import { writeOrAsk, type CaptureDraft } from "../../src/capture/pdfFinding";
import type { LibraryMutations } from "../../src/storage";

const logError = jest.fn(async (..._args: unknown[]) => undefined);
const log = { log: async () => undefined, error: logError } as unknown as ILogger;
const importPaper = jest.fn(async (targetDir: string, paper: ImportedPaper): Promise<PaperRecord> =>
  ({ id: "lee2020attention", citeKey: "lee2020attention", path: `${targetDir}/lee2020attention`, status: "unread", title: paper.metadata.title }));
const mutations = { importPaper } as unknown as LibraryMutations;
const addItem = jest.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
const notes = { addItem } as never;

const draft = (): CaptureDraft => ({
  pageUrl: "https://pub.example/article/1", ids: {}, metadata: { title: "Attention", authors: ["Ann Lee"], year: 2020 },
  origin: "page", isPaper: true, pdfCandidates: [], fetchOpts: {}, pdfAttempts: [],
});

beforeEach(() => {
  mockPdf = undefined;
  importPaper.mockClear();
  addItem.mockReset();
  addItem.mockImplementation(async () => undefined);
  logError.mockClear();
});

describe("writeOrAsk note", () => {
  it("6.6a adds the trimmed note as the first item of the saved paper's notes after importPaper", async () => {
    const decision = await writeOrAsk(log, mutations, draft(), { note: "  idea  ", notes }, "save");

    expect(decision.kind).toBe("saved");
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith("lee2020attention", { body: "idea" });
    expect(importPaper).toHaveBeenCalledTimes(1);
    expect(importPaper.mock.invocationCallOrder[0]!).toBeLessThan(addItem.mock.invocationCallOrder[0]!);
  });

  it("6.6a passes no note key in the extra given to importPaper", async () => {
    await writeOrAsk(log, mutations, draft(), { tags: ["NLP"], note: "  idea  ", notes }, "save");

    const paper = importPaper.mock.calls[0]![1];
    expect(paper.extra ?? {}).not.toHaveProperty("note");
    expect(paper.extra).toMatchObject({ tags: ["NLP"] });
  });

  it("6.6a writes the note when the PDF was found too", async () => {
    mockPdf = { bytes: new Uint8Array([37, 80, 68, 70]), url: "https://pub.example/a.pdf", source: "page" };

    const decision = await writeOrAsk(log, mutations, draft(), { note: "idea", notes });

    expect(decision).toMatchObject({ kind: "saved", saved: { pdfSource: "page" } });
    expect(addItem).toHaveBeenCalledWith("lee2020attention", { body: "idea" });
  });

  it("6.6b calls no addItem when no note is given", async () => {
    const decision = await writeOrAsk(log, mutations, draft(), { notes }, "save");

    expect(decision.kind).toBe("saved");
    expect(addItem).not.toHaveBeenCalled();
  });

  it("6.6b calls no addItem for an empty note", async () => {
    const decision = await writeOrAsk(log, mutations, draft(), { note: "", notes }, "save");

    expect(decision.kind).toBe("saved");
    expect(addItem).not.toHaveBeenCalled();
  });

  it("6.6b calls no addItem for a whitespace-only note", async () => {
    const decision = await writeOrAsk(log, mutations, draft(), { note: " \n\t  ", notes }, "save");

    expect(decision.kind).toBe("saved");
    expect(addItem).not.toHaveBeenCalled();
  });

  it("6.6c logs the error and still resolves to saved when addItem rejects", async () => {
    addItem.mockRejectedValue(new Error("disk full"));

    const decision = await writeOrAsk(log, mutations, draft(), { note: "idea", notes }, "save");

    expect(decision).toMatchObject({ kind: "saved" });
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
    expect(importPaper).toHaveBeenCalledTimes(1);
  });
});
