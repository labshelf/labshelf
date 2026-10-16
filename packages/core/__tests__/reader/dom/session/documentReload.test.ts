// Tests reloading the open PDF in place: the reader's spot survives, bursts coalesce, and a failed read keeps the document.
import { DOCUMENT_REPLACED, DocumentReloader } from "../../../../src/reader/dom/session/documentReload";
import type { ReaderContext } from "../../../../src/reader/dom/session/context";

type Listener = (evt: unknown) => void;

function fakeDoc(numPages: number) {
  return { numPages, loadingTask: { destroy: jest.fn(async () => undefined) } };
}

function setup(options: { failRead?: boolean } = {}) {
  const listeners = new Map<string, Array<{ fn: Listener; once: boolean }>>();
  const dispatched: string[] = [];
  const eventBus = {
    on: (name: string, fn: Listener, opts?: { once?: boolean }) => {
      listeners.set(name, [...(listeners.get(name) ?? []), { fn, once: Boolean(opts?.once) }]);
    },
    dispatch: (name: string, evt: unknown = {}) => {
      dispatched.push(name);
      for (const l of listeners.get(name) ?? []) { l.fn(evt); }
      listeners.set(name, (listeners.get(name) ?? []).filter((l) => !l.once));
    },
  };
  const opened: Array<ReturnType<typeof fakeDoc>> = [];
  let pages = 9;
  const pdfViewer = {
    currentPageNumber: 4,
    currentScaleValue: "1.5",
    scrollPageIntoView: jest.fn(),
    setDocument: jest.fn(),
  };
  const first = fakeDoc(9);
  const ctx = {
    boot: { assets: { pdfUrl: "x" } },
    pdfjsLib: { getDocument: () => { const d = fakeDoc(pages); opened.push(d); return { promise: Promise.resolve(d) }; } },
    pdfDocument: first,
    pdfViewer,
    linkService: { setDocument: jest.fn() },
    eventBus,
  } as unknown as ReaderContext;
  let reads = 0;
  const readUrls: string[] = [];
  const fetchMock = jest.fn(async (url: string) => {
    reads++;
    readUrls.push(url);
    return options.failRead ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const reloader = new DocumentReloader(ctx, {});
  const layOut = () => eventBus.dispatch("pagesinit");
  const setPages = (n: number) => { pages = n; };
  return { ctx, reloader, eventBus, dispatched, opened, first, pdfViewer, layOut, setPages, readUrls, reads: () => reads };
}

describe("DocumentReloader", () => {
  it("swaps the document, announces it, frees the old one and restores page, offset and zoom", async () => {
    const t = setup();
    t.eventBus.dispatch("updateviewarea", { location: { pageNumber: 3, left: 10, top: 500, scale: 1.5 } });
    await t.reloader.reload();
    expect(t.ctx.pdfDocument).toBe(t.opened[0]);
    expect(t.dispatched).toContain(DOCUMENT_REPLACED);
    expect(t.pdfViewer.setDocument).toHaveBeenCalledWith(t.opened[0]);
    expect(t.first.loadingTask.destroy).toHaveBeenCalled();
    t.pdfViewer.currentScaleValue = "auto";
    // The new document's first layout reports page 1; it must not become the spot.
    t.eventBus.dispatch("updateviewarea", { location: { pageNumber: 1, left: 0, top: 0, scale: 1 } });
    t.layOut();
    expect(t.pdfViewer.currentScaleValue).toBe("1.5");
    expect(t.pdfViewer.scrollPageIntoView).toHaveBeenCalledWith({
      pageNumber: 3, destArray: [null, { name: "XYZ" }, 10, 500, null], allowNegativeOffset: true,
    });
  });

  it("clamps the page when the new document is shorter, and falls back to the current page without a location", async () => {
    const t = setup();
    t.pdfViewer.currentPageNumber = 8;
    t.setPages(5);
    await t.reloader.reload();
    t.layOut();
    expect(t.pdfViewer.scrollPageIntoView).toHaveBeenCalledWith({ pageNumber: 5 });
  });

  it("coalesces a burst into the reload in flight plus one more", async () => {
    const t = setup();
    const all = [t.reloader.reload(), t.reloader.reload(), t.reloader.reload()];
    await Promise.all(all);
    expect(t.reads()).toBe(2);
    expect(t.ctx.pdfDocument).toBe(t.opened[1]);
  });

  it("rejects and keeps the open document when the file cannot be read", async () => {
    const t = setup({ failRead: true });
    await expect(t.reloader.reload()).rejects.toThrow("HTTP 404");
    expect(t.ctx.pdfDocument).toBe(t.first);
    expect(t.pdfViewer.setDocument).not.toHaveBeenCalled();
  });

  describe("switching to another file", () => {
    const at = (t: ReturnType<typeof setup>, pageNumber: number, top: number) =>
      t.eventBus.dispatch("updateviewarea", { location: { pageNumber, left: 0, top, scale: 1 } });

    it("reads the named file and lands on its first page, keeping the zoom", async () => {
      const t = setup();
      at(t, 3, 500);
      await t.reloader.reload("y");
      expect(t.readUrls).toEqual(["y"]);
      expect(t.ctx.boot.assets.pdfUrl).toBe("y");
      t.pdfViewer.currentScaleValue = "auto";
      t.layOut();
      expect(t.pdfViewer.currentScaleValue).toBe("1.5");
      expect(t.pdfViewer.scrollPageIntoView).toHaveBeenLastCalledWith({ pageNumber: 1 });
    });

    it("restores the spot the first file was left at when switching back", async () => {
      const t = setup();
      at(t, 3, 500);
      await t.reloader.reload("y");
      t.layOut();
      await t.reloader.reload("x");
      t.layOut();
      expect(t.pdfViewer.scrollPageIntoView).toHaveBeenLastCalledWith({
        pageNumber: 3, destArray: [null, { name: "XYZ" }, 0, 500, null], allowNegativeOffset: true,
      });
    });

    it("re-reads the switched-to file on a reload without a name", async () => {
      const t = setup();
      await t.reloader.reload("y");
      await t.reloader.reload();
      expect(t.readUrls).toEqual(["y", "y"]);
    });

    it("reads the latest requested file for the queued reload", async () => {
      const t = setup();
      await Promise.all([t.reloader.reload("y"), t.reloader.reload("z"), t.reloader.reload("w")]);
      expect(t.readUrls).toEqual(["y", "w"]);
    });

    it("keeps the open file when the named one cannot be read", async () => {
      const t = setup({ failRead: true });
      await expect(t.reloader.reload("y")).rejects.toThrow("HTTP 404");
      expect(t.ctx.boot.assets.pdfUrl).toBe("x");
    });
  });
});
