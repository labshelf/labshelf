// Recovers text from scans and broken-font PDFs by rendering pages with pdfjs and reading them with Tesseract.
// INVARIANT: both dependencies load lazily and their absence is non-fatal; callers fall back to the text layer.
import { errorMessage } from "../../../logging/index.js";
import type { PdfOcrEngine } from "../../pdf/index.js";
import { loadNativeCanvas } from "../canvas/index.js";
import type { PdfjsLoader } from "../loadPdfjs.js";
import { openPdfForOcr } from "./ocrDocument.js";

export interface TesseractOcrOptions {
  // The host's pdf.js, shared with every other caller that opens a PDF.
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
          this.options.onDiagnostic?.(`OCR failed on page ${pageNumber}: ${errorMessage(error)}`);
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
      this.options.onDiagnostic?.(`OCR unavailable: ${errorMessage(error)}`);
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
