// Checks browser host routing over the library UI channel.
const mockSendRuntime = jest.fn();
const mockRecords: Array<{ id: string; path: string }> = [];
jest.mock("../../../src/platform", () => ({
  sendRuntime: (...a: unknown[]) => mockSendRuntime(...a),
  bx: { runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn(), removeListener: jest.fn() } } },
}));
jest.mock("../../../src/storage", () => ({
  createLibraryMutations: () => ({}),
  listAllRecords: async () => mockRecords,
  scanLibrary: async () => ({ tree: [], pdfDirs: new Set() }),
  createLibraryFileSystem: () => ({}),
  createSidecarPort: () => ({}),
  onFolderRecordsRebuilt: () => () => undefined,
}));
jest.mock("../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
jest.mock("../../../src/reader/service", () => ({ openReader: jest.fn() }));

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), quickPick: jest.fn(async () => "research") }));

import type { PageSpaces } from "../../../src/spaces";
import { createLoopbackTransport } from "@labshelf/core";
import { attachLibraryHost } from "../../../src/libraryUi/host";

describe("library page host", () => {
  const input = { type: "", accept: "", files: null, click: jest.fn(), addEventListener: jest.fn() };

  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: jest.fn(() => input),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      visibilityState: "visible",
    };
  });

  afterAll(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("opens the file picker for Attach PDF before the UI's post returns, inside the user's click", () => {
    const { ui, host } = createLoopbackTransport();
    attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined }, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
    ui.post({ type: "paper.attachPdf", id: "p1" });
    expect(input.click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe(".pdf,application/pdf");
  });

  it("resolves a library path to the paper stored there, once the library has loaded", async () => {
    mockRecords.push({ id: "vaswani2017attention", path: "papers/ml/vaswani2017attention" });
    const { host } = createLoopbackTransport();
    const { paperIdAtPath } = attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined }, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
    await expect(paperIdAtPath("papers/ml/vaswani2017attention")).resolves.toBe("vaswani2017attention");
    await expect(paperIdAtPath("papers/ml")).resolves.toBeNull();
    await expect(paperIdAtPath("papers/ml/unknown")).resolves.toBeNull();
  });

  it("reports the papers the UI selected through onSelection", () => {
    const { ui, host } = createLoopbackTransport();
    const onSelection = jest.fn();
    attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined }, onSelection, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
    ui.post({ type: "paper.selected", ids: ["p1", "p2"] });
    expect(onSelection).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("routes Add to Space to the chosen Space store", async () => {
    const addPapers = jest.fn(async () => undefined);
    const spaces = { store: { list: () => [{ state: "ready", space: { id: "research", name: "Research" } }], addPapers } } as unknown as PageSpaces;
    const { ui, host } = createLoopbackTransport();
    attachLibraryHost(host, { spaces, log: { log: async () => undefined, error: async () => undefined }, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
    ui.post({ type: "paper.addToSpace", ids: ["p1"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(addPapers).toHaveBeenCalledWith("research", ["p1"]);
  });

  it("answers a repeat ready with the current snapshot once the first load is done", async () => {
    const { ui, host } = createLoopbackTransport();
    attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined }, shareRelay: { requireRelay: async () => undefined, connectedRelay: async () => undefined } });
    const snapshots: unknown[] = [];
    ui.subscribe((m) => { if (m.type === "snapshot") snapshots.push(m); });
    ui.post({ type: "ready" });
    await new Promise((r) => setTimeout(r, 0));
    const afterFirst = snapshots.length;
    ui.post({ type: "ready" });
    await new Promise((r) => setTimeout(r, 0));
    expect(afterFirst).toBeGreaterThan(0);
    expect(snapshots.length).toBe(afterFirst + 1);
  });
});
