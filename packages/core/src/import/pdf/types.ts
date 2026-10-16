/** Declares the PDF import pipeline's types: the parsed record and the pdf.js shapes it reads. */
import type { BibliographicFields } from "../../model/index.js";
import type { MetadataConfidence } from "../metadata/index.js";

export interface ParsedPdfImport extends BibliographicFields {
  title: string;
  citeKey: string;
  confidence?: MetadataConfidence;
  // How the winning record was obtained, for logs and the import report.
  source?: string;
  authors: string[];
}

/**
 * Renders a PDF page and reads its text optically. Supplied by the host
 * package, because rendering needs a canvas the core cannot assume exists.
 */
export interface PdfOcrEngine {
  recognize(pdfBytes: Uint8Array, pageNumbers: number[]): Promise<string>;
}

// A run of page-1 text sharing the same font size, in reading order. Used to
// recover the title (largest font near the top) and the author line below it.
export interface TextBlock {
  size: number;
  text: string;
}

// The text of one PDF page, 1-based.
export interface PageText {
  page: number;
  text: string;
}

/**
 * Minimal pdfjs-like document surface required by the extractor. Concrete
 * pdfjs documents satisfy this shape; consumers may pass mocks in tests.
 */
export interface PdfDocumentLike {
  numPages: number;
  getMetadata(): Promise<PdfMetadataLike | undefined>;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): void | Promise<void>;
}

/**
 * The two metadata containers a PDF can carry: the Info dictionary and
 * the XMP packet. Publishers put real bibliographic data (journal, volume,
 * DOI, ISSN) in XMP, so it is a far better source than Info.
 */
export interface PdfMetadataLike {
  info?: Record<string, unknown>;
  metadata?: XmpMetadataLike | null | undefined;
}

/** pdfjs' Metadata object — key/value view over the XMP packet. */
export interface XmpMetadataLike {
  getAll?(): Record<string, unknown> | Map<string, unknown> | undefined;
  get?(name: string): unknown;
}

export interface PdfPageLike {
  getTextContent(options?: { normalizeWhitespace?: boolean }): Promise<{
    items: Array<{ str?: string; transform?: number[] }>;
  }>;
  // Optional: many publisher PDFs expose the DOI only as a link annotation,
  // which survives even when the text layer has an unusable encoding.
  getAnnotations?(): Promise<Array<{ url?: unknown; unsafeUrl?: unknown }>>;
}

/**
 * Strategy for opening a PDF byte buffer into a PdfDocumentLike. The Node
 * loader lives in @labshelf/vscode; the browser loader lives in
 * @labshelf/browser. Core never imports pdfjs directly.
 */
export interface PdfDocumentOpener {
  open(bytes: Uint8Array): Promise<PdfDocumentLike>;
}

export type PdfjsModule = Record<string, unknown>;

export interface PdfLoadingTask {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}

/** A host's pdf.js entry point; a Node host runs its worker in-process. */
export interface PdfjsLoader {
  /** The pdf.js module, imported on first use. */
  load(): Promise<PdfjsModule>;
  /** Opens a loading task with the loader's document options; `options` wins over them. */
  getDocument(options: Record<string, unknown>): Promise<PdfLoadingTask>;
}
