// Loads the pdf and reloads it in place when the host replaces the file.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PDF_FILE } from "../../library/index.js";
import { formatError } from "../../errors/index.js";
import { type ReaderAssets, deriveClampedPage } from "../index.js";
import type { PdfjsLib, PdfjsReaderLib, PerfMarks, PdfPosition, ReaderContext } from "./readerSession.js";

/**
 * Loads pdf.js and the paper's bytes as fast as the webview allows, and records the open timeline.
 */

interface LoadedPdf {
  pdfjsLib: PdfjsLib;
  viewerLib: PdfjsReaderLib;
  pdfDocument: PDFDocumentProxy;
}

/**
 * How a host supplies the paper's bytes and the pdf.js worker. VS Code uses the defaults (fetch of webview URIs and a
 * Blob-URL worker); a browser extension page reads IndexedDB and starts the worker from its own URL, because MV3 CSP
 * (Firefox in particular) refuses blob: workers.
 */
export interface PdfSourceHooks {
  /** Called at t=0, before pdf.js is imported, and again on every reload. Default: fetch(assets.pdfUrl). */
  readBytes?(): Promise<ArrayBuffer>;
  /** Called once at t=0; the worker becomes GlobalWorkerOptions.workerPort. Default: Blob URL of the fetched worker source. */
  createWorker?(workerUrl: string): Worker;
}

/**
 * @returns the pdf.js libraries and the opened document.
 */
export async function loadPdf(assets: ReaderAssets, perf: PerfMarks, hooks: PdfSourceHooks = {}): Promise<LoadedPdf> {
  if (!assets.pdfjsUrl || !assets.viewerUrl) { throw new Error("PDF.js viewer assets are unavailable."); }

  // Kick off every download at t=0 so the PDF bytes and the worker source
  // arrive while pdf.js is still being fetched and compiled. The webview host
  // serves neither Accept-Ranges nor Content-Length, so pdf.js would stream
  // the whole file anyway — only later, after the imports had finished.
  const pdfBytesPromise = startPdfBytes(assets, perf, hooks);
  const worker = startWorker(assets, perf, hooks);

  const pdfjsLib = (await import(assets.pdfjsUrl)) as PdfjsLib;
  perf.mark("pdfjsImported");
  // pdf_viewer.mjs reads the core library from this global.
  (globalThis as { pdfjsLib?: PdfjsLib }).pdfjsLib = pdfjsLib;

  if (worker.own) { pdfjsLib.GlobalWorkerOptions.workerPort = worker.own; }
  const workerReady = bootFetchedWorker(pdfjsLib, worker.source, perf);
  const [viewerLib, pdfBytes] = await Promise.all([
    import(assets.viewerUrl) as Promise<PdfjsReaderLib>,
    pdfBytesPromise,
    workerReady,
  ]);
  perf.mark("viewerImported");

  const pdfDocument = await openPdfDocument(pdfjsLib, assets, pdfBytes);
  perf.mark("docLoaded");

  return { pdfjsLib, viewerLib, pdfDocument };
}

/**
 * @returns the paper's bytes, read through the host's hook or fetched; `fresh` bypasses the HTTP cache for a reload.
 */
function readPdfBytes(assets: ReaderAssets, hooks: PdfSourceHooks, fresh: boolean): Promise<ArrayBuffer> {
  if (hooks.readBytes) { return hooks.readBytes(); }
  return fetch(assets.pdfUrl, fresh ? { cache: "no-store" } : {}).then((r) => {
    if (!r.ok) { throw new Error(`Could not read ${PDF_FILE} (HTTP ${r.status}).`); }
    return r.arrayBuffer();
  });
}

/**
 * @returns the document parsed from `data`, which pdf.js transfers to its worker.
 */
function openPdfDocument(pdfjsLib: PdfjsLib, assets: ReaderAssets, data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument(documentParams(assets, data)).promise;
}

function startPdfBytes(assets: ReaderAssets, perf: PerfMarks, hooks: PdfSourceHooks): Promise<ArrayBuffer> {
  const bytes = readPdfBytes(assets, hooks, false).then((buf) => {
    perf.mark("pdfFetched");
    perf.set("pdfBytes", buf.byteLength);
    return buf;
  });
  bytes.catch(() => { /* surfaced by loadPdf's await */ });
  return bytes;
}

interface StartedWorker {
  own: Worker | null;
  source: Promise<string | null>;
}

/** A host-made worker can start right away; the default waits for its source (and for pdf.js, which owns the global). */
function startWorker(assets: ReaderAssets, perf: PerfMarks, hooks: PdfSourceHooks): StartedWorker {
  let own: Worker | null = null;
  if (hooks.createWorker && assets.workerUrl) {
    own = hooks.createWorker(assets.workerUrl);
    perf.mark("workerStarted");
  }
  const source: Promise<string | null> = !own && assets.workerUrl
    ? fetch(assets.workerUrl).then((r) => r.text())
    : Promise.resolve(null);
  source.catch(() => { /* surfaced by loadPdf's await */ });
  return { own, source };
}

/**
 * Boots the worker as soon as its source lands instead of after the viewer import.
 * A webview URI cannot be a module worker directly, hence the Blob URL.
 */
function bootFetchedWorker(pdfjsLib: PdfjsLib, source: Promise<string | null>, perf: PerfMarks): Promise<void> {
  return source.then((workerSrc) => {
    if (!workerSrc) { return; }
    const workerBlob = new Blob([workerSrc], { type: "text/javascript" });
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(workerBlob), { type: "module" });
    perf.mark("workerStarted");
  });
}

/**
 * pdf.js would otherwise fetch cmaps, standard fonts, wasm decoders and ICC
 * profiles from inside its worker. VS Code's webview service worker cannot
 * tie a worker request to a webview, never forwards it to the host, and the
 * request dies after its 30 s timeout — stalling the first page for 30 s on
 * any PDF that needs one of those assets. Fetching from the page works.
 */
function documentParams(assets: ReaderAssets, data: ArrayBuffer): Record<string, unknown> {
  const params: Record<string, unknown> = {
    data,
    useWorkerFetch: false,
    cMapPacked: true,
    useSystemFonts: true,
    isEvalSupported: true,
    enableHWA: true,
  };
  if (assets.cMapUrl) { params["cMapUrl"] = assets.cMapUrl; }
  if (assets.stdFontUrl) { params["standardFontDataUrl"] = assets.stdFontUrl; }
  if (assets.wasmUrl) { params["wasmUrl"] = assets.wasmUrl; }
  if (assets.iccUrl) { params["iccUrl"] = assets.iccUrl; }
  return params;
}

/**
 * An empty paper.pdf means the stored copy is unusable, not that rendering failed — tell the reader how to fix it instead of surfacing pdfjs' wording.
 * @returns a user-facing error message.
 */
export function describeLoadError(err: unknown): string {
  const msg = formatError(err);
  return /empty|zero bytes/i.test(msg)
    ? "This paper's stored PDF is empty (0 bytes), so there is nothing to display. Re-add the paper to the library to restore the file."
    : `Failed to initialize PDF viewer: ${msg}`;
}

/**
 * Replaces the open PDF with a fresh read of the same file, keeping the page, the offset on it and the zoom,
 * or with another file, shown where it was last left, else on its first page.
 */

/**
 * Dispatched on the pdf.js event bus once `ctx.pdfDocument` is the new document, before its pages are laid out.
 * Everything that caches per-document data listens for it.
 */
export const DOCUMENT_REPLACED = "labshelfdocumentreplaced";

interface Spot {
  location: PdfPosition | null;
  pageNumber: number;
  scaleValue: string;
}

export class PdfReloader {
  private location: PdfPosition | null = null;
  // INVARIANT: true from the swap until the position is restored, so the new document's page-1 layout is never taken as the reader's spot.
  private swapping = false;
  private readonly spotsByUrl = new Map<string, Spot>();
  // The file the latest request asked for; a queued reload reads it, not the file asked for when it was queued.
  private wantedUrl: string | null = null;
  private running: Promise<void> | null = null;
  private next: Promise<void> | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly hooks: PdfSourceHooks) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfPosition }) => {
      if (evt.location && !this.swapping) { this.location = evt.location; }
    });
  }

  /**
   * Reloads now, or once more after the reload in flight, so a burst of builds costs at most two reads.
   * @param pdfUrl the file to show instead of the open one; the open one when omitted.
   * @returns resolves when this request's document is in place; rejects, keeping the open document, when it cannot be read.
   */
  reload(pdfUrl?: string): Promise<void> {
    if (pdfUrl !== undefined) { this.wantedUrl = pdfUrl; }
    if (this.running) {
      // The reload in flight read the file before this request; its failure is reported to its own caller.
      this.next ??= this.running.catch(() => undefined).then(() => {
        this.next = null;
        return this.reload();
      });
      return this.next;
    }
    this.running = this.readAndSwap().finally(() => { this.running = null; });
    return this.running;
  }

  private async readAndSwap(): Promise<void> {
    const { ctx } = this;
    const url = this.wantedUrl ?? ctx.boot.assets.pdfUrl;
    try {
      const source = { ...ctx.boot.assets, pdfUrl: url };
      const bytes = await readPdfBytes(source, this.hooks, true);
      this.swap(await openPdfDocument(ctx.pdfjsLib, source, bytes), url);
    } catch (err) {
      if (this.wantedUrl === url) { this.wantedUrl = null; }
      throw err;
    }
  }

  private swap(next: PDFDocumentProxy, url: string): void {
    const { ctx } = this;
    const previous = ctx.pdfDocument;
    const { pdfViewer } = ctx;
    let spot: Spot = { location: this.location, pageNumber: pdfViewer.currentPageNumber, scaleValue: pdfViewer.currentScaleValue };
    if (url !== ctx.boot.assets.pdfUrl) {
      this.spotsByUrl.set(ctx.boot.assets.pdfUrl, spot);
      spot = this.spotsByUrl.get(url) ?? { location: null, pageNumber: 1, scaleValue: spot.scaleValue };
      this.location = spot.location;
      ctx.boot.assets.pdfUrl = url;
    }
    this.swapping = true;
    ctx.eventBus.on("pagesinit", () => this.restore(spot), { once: true });
    ctx.pdfDocument = next;
    ctx.eventBus.dispatch(DOCUMENT_REPLACED, { source: this });
    ctx.linkService.setDocument(next, null);
    ctx.pdfViewer.setDocument(next);
    // Frees the old document in the worker; pdf.js' own viewer does the same when it opens another file.
    void previous.loadingTask.destroy();
  }

  private restore({ location, pageNumber, scaleValue }: Spot): void {
    const { pdfViewer, pdfDocument } = this.ctx;
    pdfViewer.currentScaleValue = scaleValue;
    const page = deriveClampedPage(location?.pageNumber ?? pageNumber, pdfDocument.numPages);
    pdfViewer.scrollPageIntoView(location
      ? { pageNumber: page, destArray: [null, { name: "XYZ" }, location.left, location.top, null], allowNegativeOffset: true }
      : { pageNumber: page });
    this.swapping = false;
  }
}
