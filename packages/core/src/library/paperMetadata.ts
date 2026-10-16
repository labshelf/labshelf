// Reads a paper folder's metadata.yaml into a PaperRecord (id is the folder name, title falls back to the id).
// INVARIANT: hasPdf comes from the folder listing, never from the file.
import YAML from "yaml";

import { BIBLIOGRAPHIC_STRING_FIELDS, isPaperStatus, isPdfVersion, parseTextLayerInfo, type PaperRecord } from "../model/index.js";

export interface PaperLocation {
  /** Folder name, which is the paper id. */
  id: string;
  /** Absolute path of the paper folder on this device. */
  path: string;
  /** Whether <folder>/paper.pdf exists on this device. */
  hasPdf: boolean;
}

/**
 * Parses metadata.yaml text.
 * @returns the mapping, or undefined when the text is not a YAML mapping
 */
export function parsePaperMetadata(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = YAML.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the record of one paper from its parsed metadata.yaml.
 * @returns the PaperRecord
 */
export function paperRecordFromMetadata(meta: Record<string, unknown>, location: PaperLocation): PaperRecord {
  const authors = stringList(meta["authors"]);
  const keywords = stringList(meta["keywords"]);
  const tags = stringList(meta["tags"]);
  const textLayer = parseTextLayerInfo(meta["textLayer"]);
  const status = meta["status"];
  const record: PaperRecord = {
    id: location.id,
    title: typeof meta["title"] === "string" ? meta["title"] : location.id,
    path: location.path,
    citeKey: typeof meta["citekey"] === "string" ? meta["citekey"] : location.id,
    status: isPaperStatus(status) ? status : "unread",
    hasPdf: location.hasPdf,
  };
  if (authors.length) { record.authors = authors; }
  if (typeof meta["year"] === "number") { record.year = meta["year"]; }
  for (const key of BIBLIOGRAPHIC_STRING_FIELDS) {
    const value = meta[key];
    if (typeof value === "string") { record[key] = value; }
  }
  if (keywords.length) { record.keywords = keywords; }
  if (textLayer) { record.textLayer = textLayer; }
  if (tags.length) { record.tags = tags; }
  if (typeof meta["note"] === "string") { record.note = meta["note"]; }
  if (isPdfVersion(meta["pdfVersion"])) { record.pdfVersion = meta["pdfVersion"]; }
  if (isIsoDay(meta["pdfRequestedAt"])) { record.pdfRequestedAt = meta["pdfRequestedAt"]; }
  if (isIsoTimestamp(meta["statusChangedAt"])) { record.statusChangedAt = meta["statusChangedAt"]; }
  return record;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Keeps the string entries of a YAML list; anything else yields an empty list.
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
