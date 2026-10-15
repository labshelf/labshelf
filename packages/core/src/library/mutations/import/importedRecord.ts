/** Builds paper records from bibliographic metadata, whether parsed from a PDF or resolved from a registry. */
import { BIBLIOGRAPHIC_STRING_FIELDS, type BibliographicFields, type PaperRecord } from "../../../model/index.js";

/** The bibliographic fields a record takes; the io PDF parser's and registries' results satisfy it. */
export interface RecordMetadata extends BibliographicFields {
  title?: string | undefined;
}

/** What an import needs from parsing a PDF; `PdfImportParser.parse` returns a superset. */
export interface ParsedImport extends RecordMetadata {
  title: string;
  citeKey: string;
  confidence?: string | undefined;
  source?: string | undefined;
}

/** @returns the non-empty bibliographic fields of `meta`, without the title */
export function metadataFields(meta: RecordMetadata): Partial<PaperRecord> {
  const out: Partial<PaperRecord> = {};
  if (meta.authors?.length) { out.authors = meta.authors; }
  if (meta.year) { out.year = meta.year; }
  for (const key of BIBLIOGRAPHIC_STRING_FIELDS) {
    const value = meta[key];
    if (value) { out[key] = value; }
  }
  if (meta.keywords?.length) { out.keywords = meta.keywords; }
  return out;
}

/**
 * Overwrites a record's bibliographic fields with resolved ones. Identity fields stay: the folder is named after the
 * cite key.
 * @returns the updated record
 */
export function withResolvedMetadata(record: PaperRecord, meta: RecordMetadata): PaperRecord {
  return { ...record, ...(meta.title ? { title: meta.title } : {}), ...metadataFields(meta) };
}

/**
 * A record is worth reviewing when no registry confirmed it: the title and authors then come from the PDF's own
 * layout or its file name.
 * @returns true when the user should check the metadata
 */
export function needsReview(parsed: Pick<ParsedImport, "confidence" | "doi">): boolean {
  return parsed.confidence !== "high" && !parsed.doi;
}
