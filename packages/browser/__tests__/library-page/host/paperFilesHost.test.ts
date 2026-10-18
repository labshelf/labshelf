/** The library page host's answers to the paper file messages: listing, describing, opening and copying a path. */
const mockCreateTab = jest.fn();
jest.mock("../../../src/platform", () => ({
  sendRuntime: jest.fn(),
  bx: { tabs: { create: (...a: unknown[]) => mockCreateTab(...a) }, runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn(), removeListener: jest.fn() } } },
}));

const mockMutations = { listFiles: jest.fn(), describeFile: jest.fn() };
const mockBytes = new Map<string, Uint8Array>();
jest.mock("../../../src/storage", () => ({
  createLibraryMutations: () => mockMutations,
  listAllRecords: async () => [{ id: "p1", title: "P1", citeKey: "p1", path: "papers/ml/p1", status: "unread" }],
  scanLibrary: async () => ({ tree: [], pdfDirs: new Set() }),
  createLibraryFileSystem: () => ({
    async stat(path: string) { return mockBytes.has(path) ? { size: mockBytes.get(path)!.length } : undefined; },
    async readFile(path: string) { return mockBytes.get(path); },
  }),
  createSidecarPort: () => ({}),
}));
jest.mock("../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
const mockOpenReader = jest.fn();
jest.mock("../../../src/reader/access", () => ({ openReader: (...a: unknown[]) => mockOpenReader(...a) }));

import { createLoopbackTransport, type HostToUi, type PaperFilesState } from "@labshelf/core";
import { attachLibraryHost } from "../../../src/library-page/host";

const READY: PaperFilesState = { status: "ready", files: [{ name: "paper.pdf", kind: "file", size: 10 }] } as unknown as PaperFilesState;
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup() {
  const { ui, host } = createLoopbackTransport();
  const received: HostToUi[] = [];
  const logs: Array<[string, string, string]> = [];
  const log = {
    log: async (level: string, scope: string, message: string) => { logs.push([level, scope, message]); },
    error: async (scope: string) => { logs.push(["ERROR", scope, ""]); },
  };
  attachLibraryHost(host, { log: log as never });
  ui.subscribe((m) => received.push(m));
  ui.post({ type: "ready" });
  for (let i = 0; i < 5; i++) await tick();
  received.length = 0;
  logs.length = 0;
  return { ui, received, logs, types: () => received.map((m) => m.type) };
}

const clipboard = { writeText: jest.fn(async () => undefined) };

beforeAll(() => {
  (globalThis as { navigator?: unknown }).navigator = { clipboard };
  (globalThis as { document?: unknown }).document = { addEventListener: jest.fn(), removeEventListener: jest.fn(), visibilityState: "visible" };
  (URL as { createObjectURL: unknown }).createObjectURL = jest.fn(() => "blob:file");
});

afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

beforeEach(() => {
  mockMutations.listFiles.mockReset();
  mockMutations.describeFile.mockReset();
  mockCreateTab.mockReset();
  mockOpenReader.mockReset();
  clipboard.writeText.mockClear();
  mockBytes.clear();
});

describe("paper.files", () => {
  it("answers with the listing mutations.listFiles returned", async () => {
    mockMutations.listFiles.mockResolvedValue(READY);
    const { ui, received } = await setup();
    ui.post({ type: "paper.files", id: "p1" });
    await tick();
    expect(mockMutations.listFiles).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", path: "papers/ml/p1" }));
    expect(received).toContainEqual({ type: "files", id: "p1", state: READY });
  });

  it("passes a failed listing through as it is", async () => {
    const failed: PaperFilesState = { status: "failed", message: "disk" };
    mockMutations.listFiles.mockResolvedValue(failed);
    const { ui, received } = await setup();
    ui.post({ type: "paper.files", id: "p1" });
    await tick();
    expect(received).toContainEqual({ type: "files", id: "p1", state: failed });
  });

  it("answers failed and logs for an unknown paper", async () => {
    const { ui, received, logs } = await setup();
    ui.post({ type: "paper.files", id: "nope" });
    await tick();
    expect(mockMutations.listFiles).not.toHaveBeenCalled();
    expect(received).toContainEqual({ type: "files", id: "nope", state: expect.objectContaining({ status: "failed" }) });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("paper.describeFile", () => {
  it("describes the file, then posts a snapshot and the fresh files, in that order", async () => {
    mockMutations.describeFile.mockResolvedValue({ id: "p1" });
    mockMutations.listFiles.mockResolvedValue(READY);
    const { ui, types } = await setup();
    ui.post({ type: "paper.describeFile", id: "p1", name: "data.csv", description: "raw data" });
    await tick();
    expect(mockMutations.describeFile).toHaveBeenCalledWith({ id: "p1", path: "papers/ml/p1" }, "data.csv", "raw data");
    const t = types().filter((x) => x === "snapshot" || x === "files");
    expect(t).toEqual(["snapshot", "files"]);
  });

  it("reports an error notice, logs, and posts no files when describing fails", async () => {
    mockMutations.describeFile.mockRejectedValue(new Error("disk full"));
    const { ui, received, logs, types } = await setup();
    ui.post({ type: "paper.describeFile", id: "p1", name: "data.csv", description: "x" });
    await tick();
    expect(received).toContainEqual({ type: "notice", kind: "error", text: expect.stringContaining("disk full") });
    expect(logs.some((l) => l[0] === "ERROR")).toBe(true);
    expect(types()).not.toContain("files");
  });
});

describe("paper.copyFilePath", () => {
  it("copies the library-relative path and posts a notice", async () => {
    const { ui, received } = await setup();
    ui.post({ type: "paper.copyFilePath", id: "p1", name: "data.csv" });
    await tick();
    expect(clipboard.writeText).toHaveBeenCalledWith("papers/ml/p1/data.csv");
    expect(received.some((m) => m.type === "notice")).toBe(true);
  });
});

describe("paper.openFile", () => {
  it("opens paper.pdf in the reader", async () => {
    mockBytes.set("papers/ml/p1/paper.pdf", new TextEncoder().encode("%PDF-1.7 body"));
    const { ui } = await setup();
    ui.post({ type: "paper.openFile", id: "p1", name: "paper.pdf" });
    await tick();
    expect(mockOpenReader).toHaveBeenCalledWith("p1");
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it("opens any other file's bytes in a new tab through a blob URL", async () => {
    mockBytes.set("papers/ml/p1/notes.txt", new TextEncoder().encode("hello"));
    const { ui } = await setup();
    ui.post({ type: "paper.openFile", id: "p1", name: "notes.txt" });
    await tick();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockCreateTab).toHaveBeenCalledWith({ url: "blob:file" });
    expect(mockOpenReader).not.toHaveBeenCalled();
  });
});

describe("paper.selected", () => {
  it("is handled silently", async () => {
    const { ui, received, logs } = await setup();
    ui.post({ type: "paper.selected", id: "p1" });
    ui.post({ type: "paper.selected", id: null });
    await tick();
    expect(logs.filter((l) => l[2] === "Unhandled library UI message")).toEqual([]);
    expect(received).toEqual([]);
  });
});
