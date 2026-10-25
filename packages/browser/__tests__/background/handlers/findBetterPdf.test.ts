/** "Find Published Version" in the background: replaces a preprint's PDF with a better copy, or reports a miss. */
import type { ILogger, PaperRecord } from "@labshelf/core";

let mockRecords: PaperRecord[] = [];
const mockFindPdf = jest.fn();
const mockDraftFromRecord = jest.fn();
const mockAttach = jest.fn(async () => ({ record: {}, written: true }));
const mockPublishedDoiOf = jest.fn();
const mockBroadcast = jest.fn();

jest.mock("../../../src/platform", () => ({
  bx: {}, readSettings: async () => ({ contactEmail: "me@uni.edu" }),
}));
jest.mock("../../../src/storage", () => ({
  listCachedPaperRecords: async () => mockRecords, buildFolderTree: () => [], pdfDirs: () => new Set(),
}));
jest.mock("../../../src/capture/index", () => ({
  attachPdfToPaper: (...a: unknown[]) => (mockAttach as (...x: unknown[]) => unknown)(...a),
  createDraftFromPaper: (...a: unknown[]) => mockDraftFromRecord(...a),
  findPdf: (...a: unknown[]) => mockFindPdf(...a),
  normalizeFolder: (f: string) => f,
  derivePdfMiss: () => ({ reason: "miss-summary" }),
}));
jest.mock("../../../src/background/handlers/capture", () => ({ attachFoundPdf: jest.fn() }));
jest.mock("../../../src/background/draftCache", () => ({ removePaperDrafts: jest.fn() }));
jest.mock("../../../src/background/broadcast", () => ({ sendLibraryChanged: (...a: unknown[]) => mockBroadcast(...a) }));
jest.mock("../../../src/libraryUi", () => ({ createFolderHash: () => "" }));
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  findPublishedDoi: (...a: unknown[]) => mockPublishedDoiOf(...a),
}));

import { answerFindBetterPdf } from "../../../src/background/handlers/library";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const mutations = {} as never;

const record = (over: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id: "p1", title: "Deep", citeKey: "p1", path: "papers/p1", status: "unread", pdfVersion: "preprint", ...over });
const bytes = new Uint8Array([1, 2, 3]);

function draft() {
  return { ids: { arxivId: "2101.00001" }, metadata: { title: "Deep" }, pdfAttempts: [] as unknown[], betterThan: undefined as unknown };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecords = [record()];
  mockPublishedDoiOf.mockResolvedValue(undefined);
});

describe("answerFindBetterPdf", () => {
  it("replaces the file with the found version and says so", async () => {
    const d = draft();
    mockDraftFromRecord.mockResolvedValue(d);
    mockFindPdf.mockResolvedValue({ bytes, version: "published", source: "unpaywall", url: "https://x/a.pdf" });

    const result = await answerFindBetterPdf(log, mutations, "p1");

    expect(result).toEqual({ id: "p1", attached: true, replaced: true, source: "unpaywall" });
    expect(mockAttach).toHaveBeenCalledWith(mutations, "p1", bytes, { version: "published", replace: true });
    expect(mockBroadcast).toHaveBeenCalledWith("attach", "p1");
  });

  it("searches for versions that outrank the record's and uses the published DOI the preprint names", async () => {
    const d = draft();
    mockDraftFromRecord.mockResolvedValue(d);
    mockPublishedDoiOf.mockResolvedValue("10.9/journal");
    mockFindPdf.mockResolvedValue(undefined);
    mockRecords = [record({ pdfVersion: "accepted" })];

    await answerFindBetterPdf(log, mutations, "p1");

    expect(mockPublishedDoiOf).toHaveBeenCalledWith(expect.objectContaining({ contactEmail: "me@uni.edu" }), { arxivId: "2101.00001", doi: undefined });
    expect(mockFindPdf).toHaveBeenCalledWith(log, expect.objectContaining({ ids: { arxivId: "2101.00001", doi: "10.9/journal" }, betterThan: "accepted" }));
  });

  it("keeps the PDF and returns the miss summary when nothing better turns up", async () => {
    mockDraftFromRecord.mockResolvedValue(draft());
    mockFindPdf.mockResolvedValue(undefined);

    const result = await answerFindBetterPdf(log, mutations, "p1");

    expect(result).toEqual({ id: "p1", attached: false, miss: { reason: "miss-summary" } });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("throws for a PDF that is already the published version", async () => {
    mockRecords = [record({ pdfVersion: "published" })];
    await expect(answerFindBetterPdf(log, mutations, "p1")).rejects.toThrow("not a preprint");
    expect(mockFindPdf).not.toHaveBeenCalled();
  });

  it("throws for a paper that left the library", async () => {
    mockRecords = [];
    await expect(answerFindBetterPdf(log, mutations, "p1")).rejects.toThrow("no longer in your library");
  });
});
