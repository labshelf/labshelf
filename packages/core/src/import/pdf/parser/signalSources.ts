/** Turns the signals read from the file itself into metadata sources, ranked by how far each can be trusted. */
import { parseString, extractYear, SOURCE_TRUST, type MetadataSource, type ResolvedMetadata } from "../../registries/index.js";
import { normalizeAuthors } from "../authors.js";
import { extractAuthorsFromBlocks } from "../frontPageLayout.js";
import { extractKeywords } from "../keywords.js";
import { extractPublisherMetadata, hasTrustworthyTimestamps } from "../pdfDictionary.js";
import { deriveUsableTitle } from "../titleQuality.js";
import { extractJournalFromRunningHead } from "../pageHeader.js";
import type { PdfSignals } from "./readPdf.js";

export interface LocalSourceInput {
  signals: PdfSignals;
  frontMatter: string;
  abstract: string | undefined;
  layoutTitle: string | undefined;
  ocrTitle: string | undefined;
  embeddedIsReadable: boolean;
  textIsReadable: boolean;
}

export function deriveLocalSources(input: LocalSourceInput): MetadataSource[] {
  const { signals } = input;
  return [
    { name: "xmp", trust: SOURCE_TRUST.xmp, metadata: signals.xmp },
    { name: "publisher-info", trust: SOURCE_TRUST.publisherInfo, metadata: extractPublisherMetadata(signals.info) },
    { name: "pdf-text", trust: SOURCE_TRUST.pdfText, metadata: textSignals(input) },
    { name: "info", trust: SOURCE_TRUST.info, metadata: infoSignals(signals) },
    { name: "layout", trust: SOURCE_TRUST.layout, metadata: layoutSignals(input) },
    {
      name: "ocr-layout",
      trust: SOURCE_TRUST.layout,
      metadata: input.textIsReadable && input.ocrTitle ? { title: input.ocrTitle } : undefined,
    },
  ];
}

// What the page text alone can supply when no registry knows this paper.
function textSignals(input: LocalSourceInput): ResolvedMetadata | undefined {
  if (!input.textIsReadable) {
    return undefined;
  }
  const keywords = extractKeywords(input.frontMatter);
  const journal = extractJournalFromRunningHead(input.signals.pageTexts);
  const metadata: ResolvedMetadata = {
    ...(input.abstract ? { summary: input.abstract } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(journal ? { journal } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function infoSignals(signals: PdfSignals): ResolvedMetadata | undefined {
  const title = deriveUsableTitle(parseString(signals.info["Title"]));
  const authors = normalizeAuthors(parseString(signals.info["Author"]));
  // A re-saved PDF's timestamps say when it was printed, not published.
  const year = hasTrustworthyTimestamps(signals.info)
    ? extractYear(parseString(signals.info["CreationDate"]) ?? parseString(signals.info["ModDate"]))
    : undefined;
  const keywords = extractKeywords(`Keywords: ${parseString(signals.info["Keywords"]) ?? ""}`);

  const metadata: ResolvedMetadata = {
    ...(title ? { title } : {}),
    ...(authors.length ? { authors } : {}),
    ...(year ? { year } : {}),
    ...(keywords.length ? { keywords } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function layoutSignals(input: LocalSourceInput): ResolvedMetadata | undefined {
  const { layoutTitle } = input;
  if (!input.embeddedIsReadable || !layoutTitle) {
    return undefined;
  }
  const authors = extractAuthorsFromBlocks(input.signals.titleBlocks, layoutTitle);
  return { title: layoutTitle, ...(authors.length ? { authors } : {}) };
}
