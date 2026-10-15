// Recovers text from scans and broken-font PDFs by rendering pages with pdfjs and reading them with Tesseract.
// INVARIANT: both dependencies load lazily and their absence is non-fatal; callers fall back to the text layer.
import type { PdfOcrEngine } from "@labshelf/core";
import { loadNativeCanvas, nativeRenderOptions, renderPagePng, type PdfjsLoader, type PdfViewport } from "@labshelf/core/node";

// Tesseract wants roughly 300 DPI; PDF user space is 72 DPI.
const RENDER_SCALE = 300 / 72;
// Guards against a pathological page size exhausting memory.
const MAX_RENDER_PIXELS = 40_000_000;

export interface TesseractOcrOptions {
  // The extension's pdf.js, shared with every other caller that opens a PDF.
  pdfjs: PdfjsLoader;
  // Where Tesseract caches its downloaded language data between sessions.
  cachePath?: string | undefined;
  languages?: string[] | undefined;
  // Receives one-line diagnostics; OCR problems never fail an import.
  onDiagnostic?: ((message: string) => void) | undefined;
}

export class TesseractOcrEngine implements PdfOcrEngine {
  private worker: TesseractWorker | undefined;
  private workerPromise: Promise<TesseractWorker | undefined> | undefined;

  constructor(private readonly options: TesseractOcrOptions) {}

  /**
   * Renders the given pages and returns their recognized text.
   * @returns Newline-joined page text, or an empty string when OCR is unavailable.
   */
  async recognize(pdfBytes: Uint8Array, pageNumbers: number[]): Promise<string> {
    const worker = await this.ensureWorker();
    if (!worker) {
      return "";
    }
    if (!loadNativeCanvas()) {
      this.options.onDiagnostic?.("OCR unavailable: no native canvas build is installed for this platform");
      return "";
    }

    const document = await openPdfForOcr(this.options.pdfjs, pdfBytes);
    if (!document) {
      return "";
    }

    const chunks: string[] = [];
    try {
      for (const pageNumber of pageNumbers) {
        if (pageNumber > document.numPages) {
          continue;
        }
        try {
          const result = await worker.recognize(await document.renderPng(pageNumber));
          const text = result?.data?.text?.trim();
          if (text) {
            chunks.push(text);
          }
        } catch (error) {
          this.options.onDiagnostic?.(`OCR failed on page ${pageNumber}: ${describe(error)}`);
        }
      }
    } finally {
      await document.close();
    }
    return chunks.join("\n");
  }

  /**
   * Reads one page image and returns Tesseract's own text-only PDF for it: a
   * page the size of the image holding nothing but invisible, positioned text.
   * Laid over the original page it makes a scan selectable and searchable.
   * @returns The layer's PDF bytes, or undefined when OCR is unavailable or found no text.
   */
  async recognizeTextLayer(image: Buffer): Promise<Uint8Array | undefined> {
    const worker = await this.ensureWorker();
    if (!worker) {
      return undefined;
    }
    const result = await worker.recognize(image, { pdfTextOnly: true, pdfTitle: "LabShelf OCR" }, { pdf: true, text: true });
    const pdf = result?.data?.pdf;
    return pdf && result.data?.text?.trim() ? new Uint8Array(pdf) : undefined;
  }

  /**
   * Reports a one-line diagnostic through the engine's channel, so everything
   * OCR-related lands in the same log module.
   */
  report(message: string): void {
    this.options.onDiagnostic?.(message);
  }

  /**
   * Shuts the Tesseract worker down. Safe to call when none was started.
   */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.workerPromise = undefined;
    await worker?.terminate().catch(() => undefined);
  }

  // One worker is created on first use and reused; spinning one up costs
  // seconds and downloads language data.
  private async ensureWorker(): Promise<TesseractWorker | undefined> {
    this.workerPromise ??= this.createWorker();
    return this.workerPromise;
  }

  private async createWorker(): Promise<TesseractWorker | undefined> {
    try {
      const tesseract = (await import("tesseract.js")) as unknown as {
        createWorker: (
          langs: string | string[],
          oem?: number,
          options?: Record<string, unknown>,
        ) => Promise<TesseractWorker>;
      };
      const languages = this.options.languages?.length ? this.options.languages : ["eng"];
      const workerOptions: Record<string, unknown> = {};
      if (this.options.cachePath) {
        workerOptions["cachePath"] = this.options.cachePath;
      }

      this.options.onDiagnostic?.(`Starting OCR worker (${languages.join("+")})`);
      this.worker = await tesseract.createWorker(languages, undefined, workerOptions);
      return this.worker;
    } catch (error) {
      this.options.onDiagnostic?.(`OCR unavailable: ${describe(error)}`);
      return undefined;
    }
  }
}

interface TesseractWorker {
  recognize(
    image: Buffer | Uint8Array,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data?: { text?: string; pdf?: number[] | null } }>;
  terminate(): Promise<unknown>;
}

/** A PDF opened for optical reading; close() must be called when done. */
export interface OcrDocument {
  numPages: number;
  // The page's existing text layer, empty for a scan.
  pageText(pageNumber: number): Promise<string>;
  // The page's /Rotate angle; a rotated page renders upright, unlike its media box.
  rotation(pageNumber: number): Promise<number>;
  // Share of the page's text runs drawn invisibly (render mode 3 or 7), which
  // is how every OCR tool lays its text over a scan; undefined when no text.
  invisibleTextShare(pageNumber: number): Promise<number | undefined>;
  renderPng(pageNumber: number): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Opens a PDF for rendering onto the native canvas.
 * @returns The document handle, or undefined when no native canvas is installed.
 */
export async function openPdfForOcr(pdfjs: PdfjsLoader, pdfBytes: Uint8Array): Promise<OcrDocument | undefined> {
  const canvasPkg = loadNativeCanvas();
  if (!canvasPkg) {
    return undefined;
  }

  // The extension host is not recognised as Node by pdfjs, which would then
  // reach for a DOM canvas; the render options pin the native one instead.
  const loadingTask = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), ...nativeRenderOptions(canvasPkg) });
  const document = (await loadingTask.promise) as unknown as PdfRenderDocument;
  const { OPS } = (await pdfjs.load()) as { OPS: Record<string, number> };

  return {
    numPages: document.numPages,
    async pageText(pageNumber) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      return content.items.map((item) => item.str ?? "").join(" ");
    },
    async rotation(pageNumber) {
      return (await document.getPage(pageNumber)).rotate ?? 0;
    },
    async invisibleTextShare(pageNumber) {
      const ops = await (await document.getPage(pageNumber)).getOperatorList();
      return invisibleShare(ops, OPS);
    },
    async renderPng(pageNumber) {
      const page = await document.getPage(pageNumber);
      const viewport = scaledViewport(page);
      return renderPagePng(canvasPkg, page, viewport);
    },
    async close() {
      // The loading task owns teardown; pdfjs 6 has no PDFDocumentProxy.destroy().
      await loadingTask.destroy().catch(() => undefined);
    },
  };
}

function scaledViewport(page: PdfRenderPage): PdfViewport {
  const scaled = page.getViewport({ scale: RENDER_SCALE });
  const pixels = scaled.width * scaled.height;
  if (pixels <= MAX_RENDER_PIXELS) {
    return scaled;
  }
  return page.getViewport({ scale: RENDER_SCALE * Math.sqrt(MAX_RENDER_PIXELS / pixels) });
}

interface OperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

// Text render modes that paint nothing: 3 is invisible, 7 adds to the clip only.
const INVISIBLE_MODES = new Set([3, 7]);

/**
 * Counts which share of a page's text-showing operators run in an invisible
 * render mode. The mode is graphics state, so it follows save/restore.
 * @returns A fraction from 0 to 1, or undefined when the page shows no text.
 */
export function invisibleShare(ops: OperatorList, OPS: Record<string, number>): number | undefined {
  const showText = new Set([OPS["showText"], OPS["showSpacedText"], OPS["nextLineShowText"], OPS["nextLineSetSpacingShowText"]]);
  const saved: number[] = [];
  let mode = 0;
  let runs = 0;
  let invisible = 0;
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === OPS["save"]) {
      saved.push(mode);
    } else if (fn === OPS["restore"]) {
      mode = saved.pop() ?? 0;
    } else if (fn === OPS["setTextRenderingMode"]) {
      mode = Number(ops.argsArray[i]?.[0] ?? 0);
    } else if (showText.has(fn)) {
      runs += 1;
      if (INVISIBLE_MODES.has(mode)) {
        invisible += 1;
      }
    }
  }
  return runs === 0 ? undefined : invisible / runs;
}

interface PdfRenderPage {
  rotate?: number;
  getOperatorList(): Promise<OperatorList>;
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: Record<string, unknown>): { promise: Promise<void> };
}

interface PdfRenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfRenderPage>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
