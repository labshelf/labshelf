/** What a citation cites (the paper, a page, a highlight, a passage or a note), kept per occurrence in .labshelf/citations.json: reading and writing the file, anchoring a citation to its command, resolving an occurrence, re-anchoring on save, and the citation text of a scope (plan editor-cite-popup D1, D2). */
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
// CONTRACT: documents/contracts/collaboration.md

import { deriveAnchor, findThread, type CommentAnchor, type TextRange } from "../../collab/index.js";
// readAnchor is not on the collab index; it is the one reader of an anchor from untrusted JSON.
import { readAnchor } from "../../collab/comments.js";
import { isNonEmptyString, isRecord, isTimestamp } from "../../guards/index.js";
import type { Annotation } from "../../model/index.js";
import type { ILogger } from "../../ports/index.js";
import type { ItemFile, ItemSegment } from "../../qmd/item/itemFile.js";
import type { ProjectFormat } from "../project/index.js";
import { createCitationSnippet, findCiteKeyOccurrences, type CiteKeyOccurrence } from "./citeKeys.js";
import { deriveNotePage } from "./citeTargets.js";

export const CITATION_SCOPES_FILE = ".labshelf/citations.json";

/** A highlight or note is kept by id and read live, since its text may change; a passage keeps the selected text. */
export type CitationScope =
  | { kind: "paper" }
  | { kind: "page"; page: number }
  | { kind: "highlight"; annotationId: string; page: number }
  | { kind: "passage"; page: number; text: string }
  /** `page` is absent for a note anchored nowhere. */
  | { kind: "note"; noteId: string; page?: number };

export interface CitationScopeRecord {
  id: string;
  /** POSIX path of the source file, relative to the project folder. */
  file: string;
  key: string;
  /** The quote is the citation command alone, without a quotation placed before it. */
  anchor: CommentAnchor;
  scope: CitationScope;
  createdAt: string;
}

const VERSION = 1;
const PASSAGE_LENGTH = 2000;
const LOG_MODULE = "citationScopes";

const isPage = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

function readScope(value: unknown): CitationScope | undefined {
  if (!isRecord(value)) { return undefined; }
  const { kind, page, annotationId, text, noteId } = value;
  switch (kind) {
    case "paper": return { kind };
    case "page": return isPage(page) ? { kind, page } : undefined;
    case "highlight": return isPage(page) && isNonEmptyString(annotationId) ? { kind, annotationId, page } : undefined;
    case "passage": return isPage(page) && isNonEmptyString(text) ? { kind, page, text: text.slice(0, PASSAGE_LENGTH) } : undefined;
    case "note":
      if (!isNonEmptyString(noteId) || (page !== undefined && !isPage(page))) { return undefined; }
      return page === undefined ? { kind, noteId } : { kind, noteId, page };
    default: return undefined;
  }
}

function readRecord(value: unknown): CitationScopeRecord | undefined {
  if (!isRecord(value)) { return undefined; }
  const { id, file, key, createdAt } = value;
  const anchor = readAnchor(value["anchor"]);
  const scope = readScope(value["scope"]);
  return isNonEmptyString(id) && isNonEmptyString(file) && isNonEmptyString(key) && isTimestamp(createdAt) && anchor && scope
    ? { id, file, key, anchor: { quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix }, scope, createdAt }
    : undefined;
}

/**
 * The file comes from other machines in a shared project, so every key is checked and nothing throws.
 * @returns the valid records; an empty text, bad JSON or an unknown version gives none, with a WARN for the last two
 */
export function parseCitationScopes(text: string, logger?: Pick<ILogger, "log">): CitationScopeRecord[] {
  if (text.trim() === "") { return []; }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // TRAP: a hand edit or a half-merged file is expected input; the hover then behaves as for an unscoped citation.
    void logger?.log("WARN", LOG_MODULE, "Ignoring an unreadable citations.json");
    return [];
  }
  if (!isRecord(value) || value["version"] !== VERSION || !Array.isArray(value["citations"])) {
    void logger?.log("WARN", LOG_MODULE, "Ignoring a citations.json of an unknown version or shape", { version: isRecord(value) ? value["version"] : undefined });
    return [];
  }
  const records = value["citations"].map(readRecord).filter((record): record is CitationScopeRecord => record !== undefined);
  const skipped = value["citations"].length - records.length;
  if (skipped > 0) { void logger?.log("WARN", LOG_MODULE, "Skipped malformed records of citations.json", { skipped }); }
  return records;
}

export function formatCitationScopes(records: readonly CitationScopeRecord[]): string {
  return `${JSON.stringify({ version: VERSION, citations: records }, null, 2)}\n`;
}

/**
 * The record of a citation just inserted.
 * @param command the range of the citation command in `text`, without a quotation placed before it
 */
export function recordCitationScope(
  text: string, command: TextRange, fields: Pick<CitationScopeRecord, "id" | "file" | "key" | "scope" | "createdAt">,
): CitationScopeRecord {
  const { scope } = fields;
  return {
    ...fields,
    anchor: deriveAnchor(text, command.start, command.end),
    scope: scope.kind === "passage" ? { ...scope, text: scope.text.slice(0, PASSAGE_LENGTH) } : scope,
  };
}

/** Where the record's command is in `text`, found as a comment thread is. */
function findRecord(record: CitationScopeRecord, text: string): TextRange | undefined {
  const found = findThread({ id: record.id, file: record.file, anchor: record.anchor, comments: [], resolved: false }, text);
  return found === "detached" ? undefined : found;
}

/**
 * The record of one citation occurrence: among the records of the file and key whose command is found around the
 * occurrence, the newest.
 * @returns undefined when no record covers it, and the citation has no scope
 */
export function resolveCitationScope(
  records: readonly CitationScopeRecord[], file: string, text: string, occurrence: Pick<CiteKeyOccurrence, "key" | "start" | "end">,
): CitationScopeRecord | undefined {
  let best: CitationScopeRecord | undefined;
  for (const record of records) {
    if (record.file !== file || record.key !== occurrence.key) { continue; }
    const range = findRecord(record, text);
    if (!range || range.start > occurrence.start || range.end < occurrence.end) { continue; }
    if (!best || Date.parse(record.createdAt) > Date.parse(best.createdAt)) { best = record; }
  }
  return best;
}

/**
 * The records after a save of `file`: each of its records gets the command and context it is found at now; one whose
 * command is gone or no longer cites its key is dropped. Records of other files are kept as they are.
 */
export function reanchorCitationScopes(
  records: readonly CitationScopeRecord[], file: string, text: string, format: ProjectFormat,
): CitationScopeRecord[] {
  return records.flatMap((record) => {
    if (record.file !== file) { return [record]; }
    const range = findRecord(record, text);
    if (!range) { return []; }
    const anchor = deriveAnchor(text, range.start, range.end);
    return findCiteKeyOccurrences(format, anchor.quote).some((cited) => cited.key === record.key) ? [{ ...record, anchor }] : [];
  });
}

/** The records whose file is still in the project, so a deleted file's records go with the next write. */
export function pruneCitationScopes(records: readonly CitationScopeRecord[], files: ReadonlySet<string>): CitationScopeRecord[] {
  return records.filter((record) => files.has(record.file));
}

/** The paper's highlights and notes a scope's id points at. */
export interface CitationScopeLookups {
  annotations: readonly Annotation[];
  notes: ItemFile | undefined;
}

export function findScopeNote(notes: ItemFile | undefined, noteId: string): ItemSegment | undefined {
  return notes?.segments.find((segment): segment is ItemSegment => segment.kind === "item" && segment.id === noteId);
}

/** The page and the text a scope can quote, read live for a highlight or note; a deleted one keeps its stored page and has no text. */
function scopeSpec(scope: CitationScope, { annotations, notes }: CitationScopeLookups): { page?: number; text?: string } {
  switch (scope.kind) {
    case "paper": return {};
    case "page": return { page: scope.page };
    case "passage": return { page: scope.page, text: scope.text };
    case "highlight": {
      const highlight = annotations.find((annotation) => annotation.id === scope.annotationId);
      return highlight ? { page: highlight.pageNumber, text: highlight.content } : { page: scope.page };
    }
    case "note": {
      const note = findScopeNote(notes, scope.noteId);
      const page = (note ? deriveNotePage(note, annotations) : undefined) ?? scope.page;
      return { ...(page === undefined ? {} : { page }), ...(note ? { text: note.body } : {}) };
    }
  }
}

/** The citation text of a scope: the page in the supplement for every kind but the paper, and the quotation before it when `quoted` and the scope has text. */
export function createScopedCitation(format: ProjectFormat, key: string, scope: CitationScope, quoted: boolean, lookups: CitationScopeLookups): string {
  const { page, text } = scopeSpec(scope, lookups);
  const quotation = quoted && text !== undefined && text.trim() !== "" ? text : undefined;
  return createCitationSnippet(format, key, { ...(page === undefined ? {} : { page }), ...(quotation === undefined ? {} : { quotation }) });
}
