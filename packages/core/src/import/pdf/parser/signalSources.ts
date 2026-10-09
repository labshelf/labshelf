/** Turns the signals read from the file itself into metadata sources, ranked by how far each can be trusted. */
import { asString, extractYear, SOURCE_TRUST, type MetadataSource, type ResolvedMetadata } from "../../metadata/index.js";
import { normalizeAuthors } from "../authors.js";
import { authorsFromBlocks } from "../frontPageLayout.js";
import { keywordsFromText } from "../frontMatter/index.js";
import { publisherMetadataFromInfo, timestampsAreTrustworthy } from "../infoDictionary.js";
import { usableTitle } from "../quality/index.js";
import { journalFromRunningHead } from "../runningHead.js";
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

export function localSources(input: LocalSourceInput): MetadataSource[] {
  const { signals } = input;
  return [
    { name: "xmp", trust: SOURCE_TRUST.xmp, metadata: signals.xmp },
    { name: "publisher-info", trust: SOURCE_TRUST.publisherInfo, metadata: publisherMetadataFromInfo(signals.info) },
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
  const keywords = keywordsFromText(input.frontMatter);
  const journal = journalFromRunningHead(input.signals.pageTexts);
  const metadata: ResolvedMetadata = {
    ...(input.abstract ? { summary: input.abstract } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(journal ? { journal } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function infoSignals(signals: PdfSignals): ResolvedMetadata | undefined {
  const title = usableTitle(asString(signals.info["Title"]));
  const authors = normalizeAuthors(asString(signals.info["Author"]));
  // A re-saved PDF's timestamps say when it was printed, not published.
  const year = timestampsAreTrustworthy(signals.info)
    ? extractYear(asString(signals.info["CreationDate"]) ?? asString(signals.info["ModDate"]))
    : undefined;
  const keywords = keywordsFromText(`Keywords: ${asString(signals.info["Keywords"]) ?? ""}`);

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
  const authors = authorsFromBlocks(input.signals.titleBlocks, layoutTitle);
  return { title: layoutTitle, ...(authors.length ? { authors } : {}) };
}
