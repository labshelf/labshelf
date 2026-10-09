/** Reads every signal the PDF file itself carries, in one pass over the document. */
import { extractLinkUrls, extractPageTexts, extractTitleBlocks } from "../textExtraction.js";
import { metadataFromXmp } from "../xmp.js";
import type { ResolvedMetadata } from "../../metadata/index.js";
import type { PdfDocumentLike, PdfDocumentOpener, TextBlock } from "../types.js";
import { describePdfError } from "./pdfErrors.js";

// Front matter carrying the title, authors and DOI rarely runs past page 3.
const FRONT_MATTER_PAGES = 3;

// Everything read out of the file itself, before anything goes over the network.
export interface PdfSignals {
  info: Record<string, unknown>;
  xmp: ResolvedMetadata | undefined;
  pageTexts: string[];
  frontMatter: string;
  titleBlocks: TextBlock[];
  linkUrls: string[];
}

export async function readPdf(opener: PdfDocumentOpener, pdfBytes: Uint8Array): Promise<PdfSignals> {
  const document = await openDocument(opener, pdfBytes);
  try {
    const metadata = await document.getMetadata().catch(() => undefined);
    const pageTexts = await extractPageTexts(document, FRONT_MATTER_PAGES);
    return {
      info: (metadata?.info as Record<string, unknown>) ?? {},
      xmp: metadataFromXmp(metadata?.metadata),
      pageTexts,
      frontMatter: pageTexts.join("\n"),
      titleBlocks: await extractTitleBlocks(document).catch((): TextBlock[] => []),
      linkUrls: await extractLinkUrls(document, FRONT_MATTER_PAGES).catch((): string[] => []),
    };
  } finally {
    await Promise.resolve(document.destroy()).catch(() => undefined);
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
