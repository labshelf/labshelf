/** The folded, per-field text of a paper that queries match against. */
import type { PaperRecord } from "../../model/index.js";
import { fold } from "./text/index.js";
import type { SearchField } from "./query.js";

export interface SearchDoc extends Record<SearchField, string> {
  title: string;
  /** Everything free text searches besides title and authors. */
  rest: string;
  tags: string[];
}

/** Text only the host knows: highlights and notes (terminal), the folder path shown in a list (browser). */
export interface SearchExtra {
  annotations?: string;
  folder?: string;
}

/**
 * Computed once per paper by callers that match many queries against it.
 * @returns the document
 */
export function searchDoc(record: PaperRecord, extra: SearchExtra = {}): SearchDoc {
  const rest = [
    record.id, record.citeKey, record.journal, record.publisher, record.doi, record.url, record.summary, record.note,
    record.year?.toString(), ...(record.keywords ?? []), ...(record.tags ?? []), extra.annotations, extra.folder,
  ].filter(Boolean).join("\n");
  return {
    title: fold(record.title),
    authors: fold((record.authors ?? []).join("; ")),
    keywords: fold((record.keywords ?? []).join("; ")),
    venue: fold([record.journal, record.publisher].filter(Boolean).join("; ")),
    note: fold(record.note ?? ""),
    citeKey: fold(record.citeKey),
    summary: fold(record.summary ?? ""),
    rest: fold(rest),
    tags: (record.tags ?? []).map(fold),
  };
}
