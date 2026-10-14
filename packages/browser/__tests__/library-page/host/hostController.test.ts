jest.mock("../../../src/platform", () => ({
  bx: { runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn(), removeListener: jest.fn() } } },
  BrowserLogger: class { error = jest.fn(async () => undefined); info = jest.fn(async () => undefined); },
}));
jest.mock("../../../src/storage", () => ({
  createLibraryMutations: () => ({}),
  listAllRecords: async () => [],
  scanLibrary: async () => ({ tree: [], pdfDirs: new Set() }),
  IndexedDbFileSystem: class {},
}));
jest.mock("../../../src/capture", () => ({ attachPdfToPaper: jest.fn() }));
jest.mock("../../../src/reader/readerTabs", () => ({ openReader: jest.fn() }));

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
    attachLibraryHost(host);
    ui.post({ type: "paper.attachPdf", id: "p1" });
    expect(input.click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe(".pdf,application/pdf");
  });
});
