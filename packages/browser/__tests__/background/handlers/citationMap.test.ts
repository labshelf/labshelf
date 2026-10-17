/** The citationMap.* runtime handlers: the map is built from the library's records over the IndexedDB file store, and import by DOI goes through the capture flow. */
import type { ILogger, PaperRecord } from "@labshelf/core";

let mockRecords: PaperRecord[] = [];
const mockBuild = jest.fn();
const mockDraftFromDoi = jest.fn();
const mockSaveOrAsk = jest.fn();
const mockBroadcast = jest.fn();

jest.mock("../../../src/platform", () => ({ getSettings: async () => ({ contactEmail: "me@uni.edu" }) }));
jest.mock("../../../src/storage", () => ({
  listAllRecords: async () => mockRecords,
  IndexedDbFileSystem: class { readonly kind = "idb"; },
}));
jest.mock("../../../src/capture/index", () => ({
  draftFromDoi: (...a: unknown[]) => mockDraftFromDoi(...a),
  saveOrAsk: (...a: unknown[]) => mockSaveOrAsk(...a),
}));
jest.mock("../../../src/background/broadcast", () => ({ broadcastChanged: (...a: unknown[]) => mockBroadcast(...a) }));
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  buildCitationMap: (...a: unknown[]) => mockBuild(...a),
}));

import { handleCitationMapBuild, handleCitationMapImportDoi } from "../../../src/background/handlers/citationMap";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const mutations = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockRecords = [{ id: "p1", doi: "10.1/a" } as PaperRecord];
});

describe("handleCitationMapBuild", () => {
  it("builds from the library records over the IndexedDB store, caching under .research/openalex", async () => {
    const map = { links: [], missing: [], unresolved: [] };
    mockBuild.mockResolvedValue(map);

    expect(await handleCitationMapBuild(log)).toBe(map);

    const [env, papers] = mockBuild.mock.calls[0] as [Record<string, unknown>, PaperRecord[]];
    expect(env["cacheDir"]).toBe(".research/openalex");
    expect(env["registry"]).toEqual({ logger: log, contactEmail: "me@uni.edu" });
    expect((env["fs"] as { kind: string }).kind).toBe("idb");
    expect(papers).toBe(mockRecords);
  });
});

describe("handleCitationMapImportDoi", () => {
  it("saves a missing paper through the capture flow without asking about the PDF, then tells open pages", async () => {
    const draft = { existing: undefined, metadata: { title: "Deep" } };
    mockDraftFromDoi.mockResolvedValue(draft);
    mockSaveOrAsk.mockResolvedValue({ kind: "saved", saved: { paper: { id: "p2", title: "Deep", path: "papers/p2" }, folder: "papers", pdfSource: null } });

    const result = await handleCitationMapImportDoi(log, mutations, "10.1/b");

    expect(result).toEqual({ status: "saved", id: "p2", title: "Deep" });
    expect(mockDraftFromDoi).toHaveBeenCalledWith(log, "10.1/b");
    expect(mockSaveOrAsk).toHaveBeenCalledWith(log, mutations, draft, {}, "save");
    expect(mockBroadcast).toHaveBeenCalledWith("capture", "p2");
  });

  it("reports a DOI the library already holds and writes nothing", async () => {
    mockDraftFromDoi.mockResolvedValue({ existing: { id: "p1", title: "Held" }, metadata: { title: "Held" } });

    const result = await handleCitationMapImportDoi(log, mutations, "10.1/a");

    expect(result).toEqual({ status: "already-present", id: "p1", title: "Held" });
    expect(mockSaveOrAsk).not.toHaveBeenCalled();
  });

  it("refuses a DOI no registry resolves instead of saving an untitled paper", async () => {
    mockDraftFromDoi.mockResolvedValue({ existing: undefined, metadata: {} });

    await expect(handleCitationMapImportDoi(log, mutations, "10.1/x")).rejects.toThrow(/10\.1\/x/);
    expect(mockSaveOrAsk).not.toHaveBeenCalled();
  });
});
