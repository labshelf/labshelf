/**
 * Replaces the open PDF with a fresh read of the same file, keeping the page, the offset on it and the zoom,
 * or with another file, shown where it was last left, else on its first page.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { clampPage } from "../../index.js";
import type { PdfLocation, ReaderContext } from "./context.js";
import { openPdfDocument, readPdfBytes, type PdfSourceHooks } from "./pdfLoader.js";

/**
 * Dispatched on the pdf.js event bus once `ctx.pdfDocument` is the new document, before its pages are laid out.
 * Everything that caches per-document data listens for it.
 */
export const DOCUMENT_REPLACED = "labshelfdocumentreplaced";

interface Spot {
  location: PdfLocation | null;
  pageNumber: number;
  scaleValue: string;
}

export class DocumentReloader {
  private location: PdfLocation | null = null;
  // INVARIANT: true from the swap until the position is restored, so the new document's page-1 layout is never taken as the reader's spot.
  private swapping = false;
  private readonly spotsByUrl = new Map<string, Spot>();
  // The file the latest request asked for; a queued reload reads it, not the file asked for when it was queued.
  private wantedUrl: string | null = null;
  private running: Promise<void> | null = null;
  private next: Promise<void> | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly hooks: PdfSourceHooks) {
    ctx.eventBus.on("updateviewarea", (evt: { location?: PdfLocation }) => {
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
    const page = clampPage(location?.pageNumber ?? pageNumber, pdfDocument.numPages);
    pdfViewer.scrollPageIntoView(location
      ? { pageNumber: page, destArray: [null, { name: "XYZ" }, location.left, location.top, null], allowNegativeOffset: true }
      : { pageNumber: page });
    this.swapping = false;
  }
}
