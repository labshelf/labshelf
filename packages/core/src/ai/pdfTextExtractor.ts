// Extracts per-page text and detected sections from a paper's PDF bytes for ingestion.
// Falls back to per-page chunks when no headings are detected.
import { extractPageTexts } from "../import/pdf/index.js";
import type { PdfOpener } from "../import/pdf/index.js";
import type { ILogger } from "../ports/index.js";
import { detectSections } from "./chunk/index.js";
import type { ExtractedPdfText } from "./chunk/index.js";

export class PdfTextExtractor {
  constructor(
    private readonly opener: PdfOpener,
    private readonly logger: ILogger,
  ) {}

  /**
   * Opens the PDF and returns its per-page text plus detected sections,
   * packaged for the @labshelf/core pipeline.
   *
   * @returns Extracted text with paperId metadata.
   */
  async extract(paperId: string, bytes: Uint8Array): Promise<ExtractedPdfText> {
    const document = await this.opener.open(bytes);
    try {
      const pages = await extractPageTexts(document, document.numPages, this.logger);
      return { paperId, pages, sections: detectSections(pages) };
    } finally {
      try {
        await document.destroy();
      } catch (error) {
        await this.logger.error("ai/pdf", error, { paperId, message: "PDF cleanup failed" });
      }
    }
  }
}
