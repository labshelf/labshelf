/** Builds the ParsedPdfImport record from the merged metadata of every source. */
import { makeCiteKey } from "../../../library/index.js";
import {
  mergeMetadata,
  SOURCE_TRUST,
  type MetadataSource,
  type MetadataConfidence,
  type ResolvedMetadata,
} from "../../metadata/index.js";
import type { DetectedIdentifier } from "../../identifiers/index.js";
import { normalizeAuthors } from "../authors.js";
import { yearFromText } from "../publicationYear.js";
import { normalizeTitle } from "../titleQuality.js";
import type { ParsedPdfImport } from "../pdfDocument.js";

function gradeConfidence(
  identifierConfirmed: boolean,
  resolvedOnline: boolean,
  metadata: ResolvedMetadata,
): MetadataConfidence {
  if (identifierConfirmed) {
    return "high";
  }
  if (resolvedOnline) {
    return "medium";
  }
  return metadata.title ? "medium" : "low";
}

export interface RecordInput {
  sources: MetadataSource[];
  fileStem: string;
  frontMatter: string;
  textIsReadable: boolean;
  identifiers: DetectedIdentifier[];
  identifierConfirmed: boolean;
  resolvedOnline: boolean;
  origin: string | undefined;
  usedOcr: boolean;
}

export function buildParsedRecord(input: RecordInput): ParsedPdfImport {
  const merged = mergeMetadata(input.sources);
  const metadata = merged.metadata;
  const title = normalizeTitle(metadata.title ?? input.fileStem);
  const year = metadata.year ?? (input.textIsReadable ? yearFromText(input.frontMatter) : undefined);
  const authors = normalizeAuthors(metadata.authors);
  // CONTRACT: documents/contracts/library-format.md#paper-identity (the key names the folder for good, so a guessed surname stays wrong)
  const keyAuthors = authorTrust(input.sources, merged.fieldSources["authors"]) >= SOURCE_TRUST.xmp ? authors : [];
  const citeKey = makeCiteKey({ authors: keyAuthors, year, title }, title);

  return {
    title,
    citeKey,
    authors,
    confidence: gradeConfidence(input.identifierConfirmed, input.resolvedOnline, metadata),
    ...optional("source", describeOrigin(input.origin, merged.fieldSources, input.usedOcr)),
    ...(year ? { year } : {}),
    ...optional("doi", metadata.doi),
    ...optional("journal", metadata.journal),
    ...optional("publisher", metadata.publisher),
    ...optional("volume", metadata.volume),
    ...optional("issue", metadata.issue),
    ...optional("pages", metadata.pages),
    ...optional("url", metadata.url),
    ...optional("issn", metadata.issn),
    ...optional("language", metadata.language),
    ...optional("summary", metadata.summary),
    ...(metadata.keywords?.length ? { keywords: metadata.keywords } : {}),
  };
}

function authorTrust(sources: MetadataSource[], winner: string | undefined): number {
  return sources.find((source) => source.name === winner)?.trust ?? 0;
}

// Names the winning route plus how many distinct sources contributed, which is
// what a maintainer reading the log actually wants to know.
function describeOrigin(
  origin: string | undefined,
  fieldSources: Record<string, string>,
  usedOcr: boolean,
): string | undefined {
  const contributors = new Set(Object.values(fieldSources));
  if (contributors.size === 0) {
    return origin;
  }
  const base = origin ?? [...contributors][0] ?? "pdf";
  const suffix = usedOcr ? " +ocr" : "";
  return `${base}${suffix} (${contributors.size} source${contributors.size === 1 ? "" : "s"})`;
}

// Emits a single-key object only when the value is present, keeping optional
// fields absent rather than set to undefined under exactOptionalPropertyTypes.
function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}
