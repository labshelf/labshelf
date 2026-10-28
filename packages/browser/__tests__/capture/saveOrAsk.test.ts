/** What a consent-gated save writes through the library mutations: the draft's record, the user's tags and note, the folder. */
import type { ILogger, ImportedPaper, PaperRecord, PdfFetchOptions, PdfSearch, ResolvedPdf } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/records", () => ({ ...jest.requireActual("../../src/storage/records"), listCachedPaperRecords: async () => [], writeCachedPaperRecord: async () => undefined }));

const mockSettings = { customResolvers: [], contactEmail: "me@uni.edu", lastFolder: "papers/Thesis" };
const mockUpdateSettings = jest.fn(async () => undefined);
jest.mock("../../src/platform/settings", () => ({ readSettings: async () => mockSettings, updateSettings: () => mockUpdateSettings() }));

let mockPdf: ResolvedPdf | undefined;
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  findPaperPdf: async (_opts: PdfFetchOptions, _search: PdfSearch, attempts: unknown[]) => {
    attempts.push({ source: "page", url: "https://pub.example/a.pdf", outcome: "html", status: 200 });
    return mockPdf;
  },
}));

import { writeOrAsk, type CaptureDraft } from "../../src/capture/captureService";
import type { LibraryMutations } from "../../src/storage";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const importPaper = jest.fn(async (targetDir: string, paper: ImportedPaper): Promise<PaperRecord> =>
  ({ id: "lee2020attention", citeKey: "lee2020attention", path: `${targetDir}/lee2020attention`, status: "unread", title: paper.metadata.title }));
const mutations = { importPaper } as unknown as LibraryMutations;

const draft = (over: Partial<CaptureDraft> = {}): CaptureDraft => ({
  pageUrl: "https://pub.example/article/1", ids: {}, metadata: { title: "Attention", authors: ["Ann Lee"], year: 2020 },
  origin: "page", isPaper: true, pdfCandidates: [], fetchOpts: {}, pdfAttempts: [], ...over,
});

beforeEach(() => {
  mockPdf = undefined;
  importPaper.mockClear();
  mockUpdateSettings.mockClear();
});

describe("writeOrAsk", () => {
  it("asks before saving a paper whose PDF cannot be reached, writing nothing", async () => {
    expect(await writeOrAsk(log, mutations, draft())).toEqual({ kind: "no-pdf", miss: { tried: 1, sources: ["page"], blocked: false, needsLogin: false } });
    expect(importPaper).not.toHaveBeenCalled();
  });

  it("saves the reference when the user confirms, with normalised tags, a trimmed note and the remembered folder", async () => {
    const decision = await writeOrAsk(log, mutations, draft(), { tags: ["NLP", "nlp", " Deep   Learning "], note: "  read  " }, "save");

    expect(decision).toMatchObject({ kind: "saved", saved: { folder: "papers/Thesis", pdfSource: null } });
    const [folder, paper] = importPaper.mock.calls[0]!;
    expect(folder).toBe("papers/Thesis");
    expect(paper).toMatchObject({ metadata: { title: "Attention", authors: ["Ann Lee"], year: 2020 }, extra: { tags: ["NLP", "Deep Learning"], note: "read" } });
    expect(paper.pdf).toBeUndefined();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("saves the PDF it found under the fallback title into a safe folder, and remembers that folder", async () => {
    mockPdf = { bytes: new Uint8Array([37, 80, 68, 70]), url: "https://pub.example/a.pdf", source: "page" };

    const decision = await writeOrAsk(log, mutations, draft({ metadata: {} }), { folder: ".research/secrets" });

    expect(decision).toMatchObject({ kind: "saved", saved: { folder: "papers", pdfSource: "page" } });
    const [folder, paper] = importPaper.mock.calls[0]!;
    expect(folder).toBe("papers");
    expect(paper).toMatchObject({ metadata: { title: "Untitled" }, pdf: mockPdf.bytes, extra: {} });
    expect(mockUpdateSettings).toHaveBeenCalled();
  });

  it("refuses a page that is not a paper and has no PDF", async () => {
    await expect(writeOrAsk(log, mutations, draft({ isPaper: false }), {}, "save")).rejects.toThrow(/No paper found on this page/);
    expect(importPaper).not.toHaveBeenCalled();
  });
});
