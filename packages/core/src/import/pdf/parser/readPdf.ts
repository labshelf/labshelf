/** Reads every signal the PDF file itself carries, in one pass over the document. */
import { extractLinkUrls, extractPageTexts, extractTitleBlocks } from "../textExtraction.js";
import { metadataFromXmp } from "../xmp.js";
import { describeError } from "../../../logging/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { ResolvedMetadata } from "../../metadata/index.js";
import type { PdfDocumentLike, PdfDocumentOpener, TextBlock } from "../types.js";
import { describePdfError } from "./pdfErrors.js";

// Front matter carrying the title, authors and DOI rarely runs past page 3.
const FRONT_MATTER_PAGES = 3;
const PDF_SIGNALS_MODULE = "import/pdf";

// Everything read out of the file itself, before anything goes over the network.
export interface PdfSignals {
  info: Record<string, unknown>;
  xmp: ResolvedMetadata | undefined;
  pageTexts: string[];
  frontMatter: string;
  titleBlocks: TextBlock[];
  linkUrls: string[];
}

export async function readPdf(
  opener: PdfDocumentOpener,
  pdfBytes: Uint8Array,
  logger: ILogger | undefined,
): Promise<PdfSignals> {
  const document = await openDocument(opener, pdfBytes);
  try {
    const metadata = await optional(document.getMetadata(), undefined, "metadata", logger);
    const pageTexts = (await extractPageTexts(document, FRONT_MATTER_PAGES, logger)).map((page) => page.text);
    return {
      info: (metadata?.info as Record<string, unknown>) ?? {},
      xmp: metadataFromXmp(metadata?.metadata),
      pageTexts,
      frontMatter: pageTexts.join("\n"),
      titleBlocks: await optional(extractTitleBlocks(document), [], "title blocks", logger),
      linkUrls: await optional(extractLinkUrls(document, FRONT_MATTER_PAGES, logger), [], "link annotations", logger),
    };
  } finally {
    await optional((async () => document.destroy())(), undefined, "cleanup", logger);
  }
}

// One unreadable signal must not cost the others, so a failure is logged and the signal left empty.
async function optional<T>(read: Promise<T>, empty: T, signal: string, logger: ILogger | undefined): Promise<T> {
  try {
    return await read;
  } catch (error) {
    await logger?.log("WARN", PDF_SIGNALS_MODULE, `PDF ${signal} unreadable; continuing without it`, {
      message: describeError(error).message,
    });
    return empty;
  }
}

// Wraps the injected opener with friendly error mapping for password-protected and corrupt PDFs.
async function openDocument(opener: PdfDocumentOpener, pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
  try {
    return await opener.open(pdfBytes);
  } catch (error) {
    throw describePdfError(error);
  }
}
