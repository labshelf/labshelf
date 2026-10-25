/** Decides whether a paper matches a query and how well: title hits rank first, then authors, then the rest. */
import type { PaperRecord } from "../../model/index.js";
import { normalizeText } from "./text/index.js";
import type { HasField, Query } from "./query.js";
import type { SearchDoc } from "./searchDoc.js";

function has(record: PaperRecord, what: HasField): boolean {
  switch (what) {
    case "pdf": return record.hasPdf !== false;
    case "note": return Boolean(record.note?.trim());
    case "doi": return Boolean(record.doi);
    case "tags": return Boolean(record.tags?.length);
    case "abstract": return Boolean(record.summary?.trim());
  }
}

function passesFilters(record: PaperRecord, doc: SearchDoc, q: Query): boolean {
  if (q.statuses.length && !q.statuses.includes(record.status)) { return false; }
  if (q.yearMin !== undefined && (record.year === undefined || record.year < q.yearMin)) { return false; }
  if (q.yearMax !== undefined && (record.year === undefined || record.year > q.yearMax)) { return false; }
  if (q.tags.some((tag) => !doc.tags.includes(tag))) { return false; }
  if (q.fields.some((f) => !doc[f.field].includes(f.value))) { return false; }
  if (q.has.some((h) => !has(record, h))) { return false; }
  return !q.missing.some((m) => has(record, m));
}

/**
 * Scores a paper against a query.
 * @returns 0 when it does not match, otherwise a rank (higher is better)
 */
export function matchPaper(record: PaperRecord, doc: SearchDoc, q: Query): number {
  if (!passesFilters(record, doc, q)) { return 0; }
  const all = `${doc.title}\n${doc.authors}\n${doc.rest}`;
  if (q.excluded.some((term) => all.includes(term))) { return 0; }
  let score = 1;
  for (const term of q.terms) {
    if (doc.title.includes(term)) {
      score += doc.title.startsWith(term) ? 12 : 10;
    } else if (doc.authors.includes(term)) {
      score += 6;
    } else if (doc.rest.includes(term)) {
      score += 2;
    } else {
      return 0;
    }
  }
  return score;
}

/**
 * @returns whether the paper matches, for callers that keep the host's own ordering
 */
export function isPaperMatch(record: PaperRecord, doc: SearchDoc, q: Query): boolean {
  return matchPaper(record, doc, q) > 0;
}

/**
 * @returns whether a short name (a collection) contains every free-text term of the query
 */
export function matchTerms(q: Query, text: string): boolean {
  const folded = normalizeText(text);
  return q.terms.every((term) => folded.includes(term));
}
