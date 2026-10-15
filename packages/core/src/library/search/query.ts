/** Declares the structured form of a search query and tests for a query without conditions. */
import type { PaperStatus } from "../../model/index.js";

/** Document fields an operator such as `author:` or `kw:` restricts a substring match to. */
export type SearchField = "authors" | "keywords" | "venue" | "note" | "citeKey" | "summary";

/** What `has:` and `no:` can test for. */
export type HasKey = "pdf" | "note" | "doi" | "tags" | "abstract";

export interface FieldFilter {
  field: SearchField;
  /** Folded substring the field must contain. */
  value: string;
}

export interface Query {
  /** Folded words and phrases; each must occur somewhere in the paper. */
  terms: string[];
  /** Folded words that must occur nowhere. */
  excluded: string[];
  /** Folded tag prefixes; each must start one of the paper's tags. */
  tags: string[];
  fields: FieldFilter[];
  /** A paper matches any of these; empty means every status. */
  statuses: PaperStatus[];
  yearMin?: number;
  yearMax?: number;
  has: HasKey[];
  missing: HasKey[];
}

export function emptyQuery(): Query {
  return { terms: [], excluded: [], tags: [], fields: [], statuses: [], has: [], missing: [] };
}

/**
 * @returns true when the query has no conditions at all
 */
export function isEmptyQuery(q: Query): boolean {
  return !q.terms.length && !q.excluded.length && !q.tags.length && !q.fields.length && !q.statuses.length
    && q.yearMin === undefined && q.yearMax === undefined && !q.has.length && !q.missing.length;
}
