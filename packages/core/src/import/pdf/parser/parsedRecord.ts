/** Builds the ParsedPdfImport record from the merged metadata of every source. */
import { mergeMetadata, type MetadataSource } from "../../metadata/index.js";
import type { DetectedIdentifier } from "../../identifiers/index.js";
import { normalizeAuthors } from "../authors.js";
import { buildCiteKey } from "../citeKey.js";
import { yearFromText } from "../frontMatter/index.js";
import { normalizeTitle } from "../quality/index.js";
import type { ParsedPdfImport } from "../types.js";
import { gradeConfidence } from "./confidence.js";

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
  const citeKey = buildCiteKey(input.fileStem, title, year, metadata.doi ?? input.identifiers[0]?.value);

  return {
    title,
    citeKey,
    authors: normalizeAuthors(metadata.authors),
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
