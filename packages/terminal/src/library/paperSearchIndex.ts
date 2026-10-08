/** The terminal's query language as a core PaperFilter: parses a query once and caches each paper's folded search text, annotation text included. */
import type { PaperEntry, PaperFilter, PaperRecord } from "@labshelf/core";

import { isEmptyQuery, matchPaper, matchesCollectionName, parseQuery, searchDoc, type SearchDoc } from "./search.js";

interface CachedDoc { record: PaperRecord; extra: string; doc: SearchDoc }

export class PaperSearchIndex {
  private readonly docs = new Map<string, CachedDoc>();
  private annotationText = new Map<string, string>();

  /** Annotation text per paper, folded into the search so a highlight finds its paper. */
  setAnnotationText(text: Map<string, string>): void {
    this.annotationText = text;
  }

  /** @returns the filter for a query, or undefined when the query has no conditions */
  filterFor = (query: string): PaperFilter | undefined => {
    const parsed = parseQuery(query);
    if (isEmptyQuery(parsed)) { return undefined; }
    return {
      keepsCollection: (name) => matchesCollectionName(parsed, name),
      score: (entry) => matchPaper(entry.record, this.doc(entry), parsed),
    };
  };

  private doc(entry: PaperEntry): SearchDoc {
    const extra = this.annotationText.get(entry.record.id) ?? "";
    const cached = this.docs.get(entry.record.id);
    if (cached && cached.record === entry.record && cached.extra === extra) { return cached.doc; }
    const doc = searchDoc(entry.record, extra);
    this.docs.set(entry.record.id, { record: entry.record, extra, doc });
    return doc;
  }
}
