/** PdfDocumentOpener that parses PDFs with pdf.js in the current Node process. */
import type { PdfDocumentLike, PdfDocumentOpener } from "../pdf/index.js";
import type { PdfjsLoader } from "./loadPdfjs.js";

export class NodePdfOpener implements PdfDocumentOpener {
  constructor(private readonly pdfjs: PdfjsLoader) {}

  async open(pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
    // pdf.js takes ownership of `data` and detaches the caller's buffer, which would leave importers with a
    // zero-length array to write to disk. It gets a private copy so the caller's bytes stay readable.
    const task = await this.pdfjs.getDocument({ data: new Uint8Array(pdfBytes) });
    const document = await task.promise;
    // pdf.js 6 dropped PDFDocumentProxy.destroy(); teardown belongs to the loading task, but core closes documents
    // through destroy().
    if (typeof (document as Partial<PdfDocumentLike>).destroy !== "function") {
      document.destroy = () => task.destroy();
    }
    return document;
  }
}
