// Parses the search query language shared by the apps into a structured query.
import { fold } from "./text/index.js";
import { emptyQuery, type Query, type HasKey, type SearchField } from "./query.js";
import { tokenize } from "./tokenize.js";
import type { PaperStatus } from "../readingStatus/index.js";

interface YearBounds {
  min?: number;
  max?: number;
}

/**
 * Accepts `2017`, `2015..2020`, `2015..`, `..2020`, `>2018`, `>=2018`, `<2000` and `<=2000`.
 * @returns the bounds, or undefined when the value is none of those
 */
function parseYearBounds(value: string): YearBounds | undefined {
  const range = /^(\d{4})?\.\.(\d{4})?$/.exec(value);
  if (range) {
    return { ...(range[1] ? { min: Number(range[1]) } : {}), ...(range[2] ? { max: Number(range[2]) } : {}) };
  }
  const comparison = /^([<>]=?)(\d{4})$/.exec(value);
  if (comparison) {
    const year = Number(comparison[2]);
    switch (comparison[1]) {
      case ">": return { min: year + 1 };
      case ">=": return { min: year };
      case "<": return { max: year - 1 };
      default: return { max: year };
    }
  }
  if (/^\d{4}$/.test(value)) { return { min: Number(value), max: Number(value) }; }
  return undefined;
}

const TAG_KEYS: ReadonlySet<string> = new Set(["tag", "t"]);
const STATUS_KEYS: ReadonlySet<string> = new Set(["status", "is", "s"]);
const YEAR_KEYS: ReadonlySet<string> = new Set(["year", "y"]);
const HAS_KEYS: ReadonlySet<string> = new Set(["has"]);
const MISSING_KEYS: ReadonlySet<string> = new Set(["no"]);

/** Operators that restrict a substring match to one document field. */
const FIELD_KEYS: ReadonlyMap<string, SearchField> = new Map<string, SearchField>([
  ["author", "authors"], ["au", "authors"], ["a", "authors"],
  ["kw", "keywords"], ["keyword", "keywords"],
  ["venue", "venue"], ["journal", "venue"],
  ["note", "note"],
  ["key", "citeKey"],
  ["abstract", "summary"],
]);

const STATUS_ALIASES: ReadonlyMap<string, PaperStatus> = new Map<string, PaperStatus>([
  ["u", "unread"], ["unread", "unread"], ["new", "unread"],
  ["r", "reading"], ["reading", "reading"],
  ["d", "done"], ["done", "done"], ["read", "done"],
]);

const HAS_ALIASES: ReadonlyMap<string, HasKey> = new Map<string, HasKey>([
  ["pdf", "pdf"], ["note", "note"], ["notes", "note"], ["doi", "doi"], ["tag", "tags"], ["tags", "tags"],
  ["abstract", "abstract"], ["summary", "abstract"],
]);

/** @returns whether `key` is an operator of the query language, whatever its value */
function isOperatorKey(key: string): boolean {
  return TAG_KEYS.has(key) || STATUS_KEYS.has(key) || YEAR_KEYS.has(key) || HAS_KEYS.has(key) || MISSING_KEYS.has(key)
    || FIELD_KEYS.has(key);
}

// True when the token was an operator (so it is not a plain term). A known key with an empty value is dropped, so a
// half-typed `author:` does not hide every paper; a known key with a value it cannot read stays a plain term.
function applyOperator(token: string, q: Query): boolean {
  if (token.startsWith("#") && token.length > 1) {
    q.tags.push(fold(token.slice(1)));
    return true;
  }
  const colon = token.indexOf(":");
  if (colon <= 0) { return false; }
  const key = token.slice(0, colon).toLowerCase();
  if (!isOperatorKey(key)) { return false; }
  const value = token.slice(colon + 1);
  if (!value) { return true; }
  const lower = value.toLowerCase();
  if (TAG_KEYS.has(key)) { q.tags.push(fold(value)); return true; }
  const field = FIELD_KEYS.get(key);
  if (field) { q.fields.push({ field, value: fold(value) }); return true; }
  const status = STATUS_ALIASES.get(lower);
  if (STATUS_KEYS.has(key) && status) { q.statuses.push(status); return true; }
  if (YEAR_KEYS.has(key)) {
    const bounds = parseYearBounds(value);
    if (!bounds) { return false; }
    if (bounds.min !== undefined) { q.yearMin = bounds.min; }
    if (bounds.max !== undefined) { q.yearMax = bounds.max; }
    return true;
  }
  const what = HAS_ALIASES.get(lower);
  if ((HAS_KEYS.has(key) || MISSING_KEYS.has(key)) && what) {
    (HAS_KEYS.has(key) ? q.has : q.missing).push(what);
    return true;
  }
  return false;
}

// Syntax (matching is case- and accent-insensitive):
//   attention transformer        every word must match (title, authors, venue, abstract, tags, note, ids…)
//   "exact phrase"               quoted phrase
//   -survey                      exclude a word
//   tag:nlp  #nlp                has exactly this tag
//   status:reading  is:unread    reading status
//   year:2017  year:2015..2020   year:>2018  year:<2000
//   author:vaswani               one field: author, kw, venue, note, key, abstract
//   has:pdf  no:pdf              has:note, has:doi, has:tags, has:abstract
export function parseQuery(text: string): Query {
  const q = emptyQuery();
  for (const token of tokenize(text)) {
    if (applyOperator(token, q)) { continue; }
    if (token.startsWith("-") && token.length > 1) {
      q.excluded.push(fold(token.slice(1)));
    } else {
      q.terms.push(fold(token));
    }
  }
  return q;
}
