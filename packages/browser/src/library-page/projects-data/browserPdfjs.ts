// Gives the core pdf.js loader port the vendored pdf.js of the extension.
import type { PdfjsLoader, PdfLoadingTask } from "@labshelf/core";
import { loadPdfjs } from "../../pdfText";

export const browserPdfjs: PdfjsLoader = {
  load: async () => (await loadPdfjs()) as unknown as Record<string, unknown>,
  getDocument: async (options) => (await loadPdfjs()).getDocument(options) as unknown as PdfLoadingTask,
};
