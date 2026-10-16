const mockSendRuntime = jest.fn();
jest.mock("../../../src/platform", () => ({
  sendRuntime: (...a: unknown[]) => mockSendRuntime(...a),
  bx: { runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn(), removeListener: jest.fn() } } },
}));
jest.mock("../../../src/storage", () => ({
  createLibraryMutations: () => ({}),
  listAllRecords: async () => [],
  scanLibrary: async () => ({ tree: [], pdfDirs: new Set() }),
  IndexedDbFileSystem: class {},
  createIdbSidecarPort: () => ({}),
}));
jest.mock("../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
jest.mock("../../../src/reader/access", () => ({ openReader: jest.fn() }));

import { createLoopbackTransport } from "@labshelf/core";
import { attachLibraryHost } from "../../../src/library-page/host";

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
    attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined } });
    ui.post({ type: "paper.attachPdf", id: "p1" });
    expect(input.click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe(".pdf,application/pdf");
  });

  it("opens the citation map from the sidebar and again when the UI asks to refresh it", async () => {
    mockSendRuntime.mockRejectedValue(new Error("offline"));
    const { ui, host } = createLoopbackTransport();
    const states: string[] = [];
    ui.subscribe((m) => { if (m.type === "citationMap.show") states.push(m.state.status); });
    const libraryHost = attachLibraryHost(host, { log: { log: async () => undefined, error: async () => undefined } });

    libraryHost.openCitationMap();
    ui.post({ type: "citationMap.refresh" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(states).toEqual(["loading", "loading", "failed", "failed"]);
  });
});
