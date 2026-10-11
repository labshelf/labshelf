/**
 * Loads pdf.js and the paper's bytes as fast as the webview allows, and records the open timeline.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PDF_FILE } from "../../../library/index.js";
import type { ReaderAssets } from "../../index.js";
import type { PdfjsLib, ViewerLib } from "./context.js";
import type { PerfMarks } from "./perfMarks.js";

export interface LoadedPdf {
  pdfjsLib: PdfjsLib;
  viewerLib: ViewerLib;
  pdfDocument: PDFDocumentProxy;
}

/**
 * How a host supplies the paper's bytes and the pdf.js worker. VS Code uses the defaults (fetch of webview URIs and a
 * Blob-URL worker); a browser extension page reads IndexedDB and starts the worker from its own URL, because MV3 CSP
 * (Firefox in particular) refuses blob: workers.
 */
export interface PdfSourceHooks {
  /** Called once at t=0, before pdf.js is imported. Default: fetch(assets.pdfUrl). */
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
    import(assets.viewerUrl) as Promise<ViewerLib>,
    pdfBytesPromise,
    workerReady,
  ]);
  perf.mark("viewerImported");

  const pdfDocument = await pdfjsLib.getDocument(documentParams(assets, pdfBytes)).promise;
  perf.mark("docLoaded");

  return { pdfjsLib, viewerLib, pdfDocument };
}

function startPdfBytes(assets: ReaderAssets, perf: PerfMarks, hooks: PdfSourceHooks): Promise<ArrayBuffer> {
  const readBytes = hooks.readBytes ?? (() => fetch(assets.pdfUrl).then((r) => {
    if (!r.ok) { throw new Error(`Could not read ${PDF_FILE} (HTTP ${r.status}).`); }
    return r.arrayBuffer();
  }));
  const bytes = readBytes().then((buf) => {
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
  const msg = err instanceof Error ? err.message : String(err);
  return /empty|zero bytes/i.test(msg)
    ? "This paper's stored PDF is empty (0 bytes), so there is nothing to display. Re-add the paper to the library to restore the file."
    : `Failed to initialize PDF viewer: ${msg}`;
}
