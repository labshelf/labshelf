// Declares a share's manifest and reads one from untrusted JSON, keeping only the fields the contract names.
import { BIBLIOGRAPHIC_STRING_FIELDS, type Annotation, type BibliographicFields } from "../model/index.js";
import { normalizePaperData } from "../reader/index.js";
import { isSha256Hex } from "../relay/index.js";

// CONTRACT: documents/contracts/share-link.md#manifest
export const SHARE_MANIFEST_VERSION = 1;

export interface SharedPaperMetadata extends BibliographicFields {
  id: string;
  title: string;
  citeKey: string;
}

/** `blob` names the stored ciphertext; `content` is the plaintext's SHA-256, from which the part's key derives. */
export interface SharedPdfPart { blob: string; content: string; size: number }
export interface SharedPdf { size: number; parts: SharedPdfPart[] }

export interface SharedPaper {
  metadata: SharedPaperMetadata;
  bib?: string;
  annotations?: Annotation[];
  pdf?: SharedPdf;
}

export interface ShareManifest {
  v: typeof SHARE_MANIFEST_VERSION;
  folder: string;
  papers: SharedPaper[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The shareable fields of a paper; the user's own fields (status, tags, note, files) never pass. */
export function sharedMetadataOf(value: unknown): SharedPaperMetadata | undefined {
  if (!isObject(value) || !isString(value["id"]) || !isString(value["title"]) || !isString(value["citeKey"])) { return undefined; }
  const metadata: SharedPaperMetadata = { id: value["id"], title: value["title"], citeKey: value["citeKey"] };
  if (isStringList(value["authors"])) { metadata.authors = value["authors"]; }
  if (typeof value["year"] === "number" && Number.isFinite(value["year"])) { metadata.year = value["year"]; }
  for (const field of BIBLIOGRAPHIC_STRING_FIELDS) {
    const text = value[field];
    if (isString(text)) { metadata[field] = text; }
  }
  if (isStringList(value["keywords"])) { metadata.keywords = value["keywords"]; }
  return metadata;
}

function pdfOf(value: unknown): SharedPdf | undefined {
  if (!isObject(value) || !isSize(value["size"]) || !Array.isArray(value["parts"])) { return undefined; }
  const parts: SharedPdfPart[] = [];
  for (const part of value["parts"]) {
    if (!isObject(part) || !isSha256Hex(part["blob"]) || !isSha256Hex(part["content"]) || !isSize(part["size"])) { return undefined; }
    parts.push({ blob: part["blob"], content: part["content"], size: part["size"] });
  }
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return parts.length > 0 && total === value["size"] ? { size: total, parts } : undefined;
}

function paperOf(value: unknown): SharedPaper | undefined {
  const metadata = isObject(value) ? sharedMetadataOf(value["metadata"]) : undefined;
  if (!isObject(value) || !metadata) { return undefined; }
  const paper: SharedPaper = { metadata };
  if (isString(value["bib"])) { paper.bib = value["bib"]; }
  if (Array.isArray(value["annotations"])) { paper.annotations = normalizePaperData({ annotations: value["annotations"] }).annotations; }
  const pdf = pdfOf(value["pdf"]);
  if (pdf) { paper.pdf = pdf; }
  return paper;
}

/** Undefined for anything but a manifest of this version; a malformed paper is dropped, a malformed PDF reads as none. */
export function decodeShareManifest(value: unknown): ShareManifest | undefined {
  if (!isObject(value) || value["v"] !== SHARE_MANIFEST_VERSION || !isString(value["folder"]) || !Array.isArray(value["papers"])) {
    return undefined;
  }
  const papers = value["papers"].map(paperOf).filter((paper): paper is SharedPaper => paper !== undefined);
  return { v: SHARE_MANIFEST_VERSION, folder: value["folder"], papers };
}
