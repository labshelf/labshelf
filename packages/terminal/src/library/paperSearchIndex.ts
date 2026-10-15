/** Applies core's query language as a core PaperFilter: parses a query once and caches each paper's folded search text, annotation text included. */
import {
  isEmptyQuery, matchPaper, matchesTerms, parseQuery, searchDoc,
  type PaperEntry, type PaperFilter, type PaperRecord, type SearchDoc,
} from "@labshelf/core";

interface CachedDoc { record: PaperRecord; annotations: string; doc: SearchDoc }

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
      keepsCollection: (name) => matchesTerms(parsed, name),
      score: (entry) => matchPaper(entry.record, this.doc(entry), parsed),
    };
  };

  /** @returns a test for whether a paper matches the query; every paper matches a query without conditions */
  matcher(query: string): (entry: PaperEntry) => boolean {
    const filter = this.filterFor(query);
    return filter ? (entry) => filter.score(entry) > 0 : () => true;
  }

  private doc(entry: PaperEntry): SearchDoc {
    const annotations = this.annotationText.get(entry.record.id) ?? "";
    const cached = this.docs.get(entry.record.id);
    if (cached && cached.record === entry.record && cached.annotations === annotations) { return cached.doc; }
    const doc = searchDoc(entry.record, { annotations });
    this.docs.set(entry.record.id, { record: entry.record, annotations, doc });
    return doc;
  }
}
