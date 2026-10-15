// Declares the text-layer step the extension runs on PDFs, so callers never depend on how it reads pages.
import type { TextLayerDetection, TextLayerOutcome } from "@labshelf/core";

export interface TextLayerProgress {
  // 1-based position among the pages being read, not the page number.
  index: number;
  total: number;
  pageNumber: number;
}

export interface TextLayerHooks {
  onProgress?: (progress: TextLayerProgress) => void;
  isCancelled?: () => boolean;
}

/** Adds a text layer to PDFs that lack one. */
export interface PdfTextLayerBuilder {
  build(pdfBytes: Uint8Array, hooks?: TextLayerHooks): Promise<TextLayerOutcome>;
  detect(pdfBytes: Uint8Array): Promise<TextLayerDetection>;
}
