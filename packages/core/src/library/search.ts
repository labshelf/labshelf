/** Defines the search query language shared by the apps: its structured form, parsing, per-paper documents, matching and the syntax help. */
import type { PaperRecord } from "../model/index.js";
import type { ReadingStatus } from "./record.js";
import { normalizeText } from "./searchText.js";

/** Document fields an operator such as `author:` or `kw:` restricts a substring match to. */
export type SearchField = "authors" | "keywords" | "venue" | "note" | "citeKey" | "summary";

/** What `has:` and `no:` can test for. */
export type HasField = "pdf" | "note" | "doi" | "tags" | "abstract";

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
  /** Folded tag names; each must equal one of the paper's tags. */
  tags: string[];
  fields: FieldFilter[];
  /** A paper matches any of these; empty means every status. */
  statuses: ReadingStatus[];
  yearMin?: number;
  yearMax?: number;
  has: HasField[];
  missing: HasField[];
}

function createEmptyQuery(): Query {
  return { terms: [], excluded: [], tags: [], fields: [], statuses: [], has: [], missing: [] };
}

/**
 * @returns true when the query has no conditions at all
 */
export function isEmptyQuery(q: Query): boolean {
  return !q.terms.length && !q.excluded.length && !q.tags.length && !q.fields.length && !q.statuses.length
    && q.yearMin === undefined && q.yearMax === undefined && !q.has.length && !q.missing.length;
}

/**
 * A `-` or `key:` prefix stays in front of a quoted phrase, and an unterminated quote runs to the end.
 * @returns the tokens, quotes removed
 */
export function splitQuery(query: string): string[] {
  const tokens: string[] = [];
  const re = /(-?[\w:#.<>=-]*?)"([^"]*)"?|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    if (match[3] !== undefined) {
      tokens.push(match[3]);
    } else {
      tokens.push((match[1] ?? "") + (match[2] ?? ""));
    }
  }
  return tokens.filter((t) => t.length > 0);
}

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

const STATUS_ALIASES: ReadonlyMap<string, ReadingStatus> = new Map<string, ReadingStatus>([
  ["u", "unread"], ["unread", "unread"], ["new", "unread"],
  ["r", "reading"], ["reading", "reading"],
  ["d", "done"], ["done", "done"], ["read", "done"],
]);

const HAS_ALIASES: ReadonlyMap<string, HasField> = new Map<string, HasField>([
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
    q.tags.push(normalizeText(token.slice(1)));
    return true;
  }
  const colon = token.indexOf(":");
  if (colon <= 0) { return false; }
  const key = token.slice(0, colon).toLowerCase();
  if (!isOperatorKey(key)) { return false; }
  const value = token.slice(colon + 1);
  if (!value) { return true; }
  const lower = value.toLowerCase();
  if (TAG_KEYS.has(key)) { q.tags.push(normalizeText(value)); return true; }
  const field = FIELD_KEYS.get(key);
  if (field) { q.fields.push({ field, value: normalizeText(value) }); return true; }
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
  const q = createEmptyQuery();
  for (const token of splitQuery(text)) {
    if (applyOperator(token, q)) { continue; }
    if (token.startsWith("-") && token.length > 1) {
      q.excluded.push(normalizeText(token.slice(1)));
    } else {
      q.terms.push(normalizeText(token));
    }
  }
  return q;
}

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
    title: normalizeText(record.title),
    authors: normalizeText((record.authors ?? []).join("; ")),
    keywords: normalizeText((record.keywords ?? []).join("; ")),
    venue: normalizeText([record.journal, record.publisher].filter(Boolean).join("; ")),
    note: normalizeText(record.note ?? ""),
    citeKey: normalizeText(record.citeKey),
    summary: normalizeText(record.summary ?? ""),
    rest: normalizeText(rest),
    tags: (record.tags ?? []).map(normalizeText),
  };
}

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

export interface SyntaxHelpRow {
  syntax: string;
  description: string;
}

export const SYNTAX_HELP: readonly SyntaxHelpRow[] = [
  { syntax: "word \"a phrase\"", description: "every word must match; -word excludes" },
  { syntax: "tag:nlp  #nlp", description: "has a tag" },
  { syntax: "status:reading  is:r", description: "unread, reading, done" },
  { syntax: "year:2015..2020", description: "publication year; also year:2017, >2018, <2000" },
  { syntax: "author:vaswani", description: "author" },
  { syntax: "kw:graphs  note:todo", description: "keywords, note; also venue:, key:, abstract:" },
  { syntax: "has:pdf  no:pdf", description: "also has:note, has:doi, has:tags, has:abstract" },
];
