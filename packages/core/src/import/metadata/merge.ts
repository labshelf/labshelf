/**
 * Combines every source into one record, field by field, each field taken from the most trustworthy source that has it.
 */
import { BIBLIOGRAPHIC_FIELDS } from "../../model/index.js";
import { normalizeCitationFields } from "./normalizeCitationFields.js";
import type { ResolvedMetadata } from "./resolvedMetadata.js";

/**
 * How much a source is trusted, relative to the others. Higher wins a field.
 * The scale is deliberately sparse so further sources can slot between these.
 */
export const SOURCE_TRUST = {
  /** A registry record reached through an identifier printed in the PDF. */
  confirmedIdentifier: 100,
  /** A second registry queried with that already-confirmed identifier. */
  enrichment: 90,
  /** A registry record found by searching, and accepted by title agreement. */
  search: 70,
  /** The PDF's own XMP packet. */
  xmp: 60,
  /** Publisher-specific keys in the Info dictionary. */
  publisherInfo: 50,
  /** Text read off the page: abstract, keywords, running head. */
  pdfText: 30,
  /** Standard Info dictionary fields. */
  info: 20,
  /** Font-size and position heuristics on page 1. */
  layout: 10,
} as const;

export interface MetadataSource {
  name: string;
  trust: number;
  metadata: ResolvedMetadata | undefined;
}

export interface MergedMetadata {
  metadata: ResolvedMetadata;
  /** Which source each populated field came from, for logs and diagnostics. */
  fieldSources: Record<string, string>;
}

// Keywords stay out of the merge; resolveMetadata takes them whole from the best source that has any.
const MERGE_FIELDS: Array<keyof ResolvedMetadata> = ["title", ...BIBLIOGRAPHIC_FIELDS.filter((field) => field !== "keywords")];

/**
 * Merges every source into one record, taking each field from the most
 * trustworthy source that has a usable value for it. No single source is
 * complete (CrossRef lacks abstracts, Semantic Scholar has a thinner venue,
 * XMP has the ISSN), so taking the first source that answers would discard most of it.
 * @returns The combined metadata plus a per-field record of where it came from.
 */
export function mergeMetadata(sources: MetadataSource[]): MergedMetadata {
  const ranked = sources
    .filter((source): source is MetadataSource & { metadata: ResolvedMetadata } => Boolean(source.metadata))
    .sort((a, b) => b.trust - a.trust);

  const metadata: Record<string, unknown> = {};
  const fieldSources: Record<string, string> = {};

  for (const field of MERGE_FIELDS) {
    for (const source of ranked) {
      const value = source.metadata[field];
      if (!isUsable(value)) {
        continue;
      }
      // A longer author list from an equally-trusted source is more complete,
      // but trust order still decides between different rankings.
      metadata[field] = value;
      fieldSources[field] = source.name;
      break;
    }
  }

  return { metadata: normalizeCitationFields(metadata as ResolvedMetadata), fieldSources };
}

/**
 * Counts how many fields of a record carry a usable value, so two candidate
 * records can be compared on completeness.
 * @returns Number of populated fields.
 */
export function deriveCompleteness(metadata: ResolvedMetadata | undefined): number {
  if (!metadata) {
    return 0;
  }
  return MERGE_FIELDS.reduce((count, field) => count + (isUsable(metadata[field]) ? 1 : 0), 0);
}

function isUsable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "number" ? Number.isFinite(value) : false;
}
