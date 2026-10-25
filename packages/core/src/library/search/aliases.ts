/** Declares the operator keys of the query language and the names each one accepts. */
import type { PaperStatus } from "../readingStatus/index.js";
import type { HasKey, SearchField } from "./query.js";

export const TAG_KEYS: ReadonlySet<string> = new Set(["tag", "t"]);
export const STATUS_KEYS: ReadonlySet<string> = new Set(["status", "is", "s"]);
export const YEAR_KEYS: ReadonlySet<string> = new Set(["year", "y"]);
export const HAS_KEYS: ReadonlySet<string> = new Set(["has"]);
export const MISSING_KEYS: ReadonlySet<string> = new Set(["no"]);

/** Operators that restrict a substring match to one document field. */
export const FIELD_KEYS: ReadonlyMap<string, SearchField> = new Map<string, SearchField>([
  ["author", "authors"], ["au", "authors"], ["a", "authors"],
  ["kw", "keywords"], ["keyword", "keywords"],
  ["venue", "venue"], ["journal", "venue"],
  ["note", "note"],
  ["key", "citeKey"],
  ["abstract", "summary"],
]);

export const STATUS_ALIASES: ReadonlyMap<string, PaperStatus> = new Map<string, PaperStatus>([
  ["u", "unread"], ["unread", "unread"], ["new", "unread"],
  ["r", "reading"], ["reading", "reading"],
  ["d", "done"], ["done", "done"], ["read", "done"],
]);

export const HAS_ALIASES: ReadonlyMap<string, HasKey> = new Map<string, HasKey>([
  ["pdf", "pdf"], ["note", "note"], ["notes", "note"], ["doi", "doi"], ["tag", "tags"], ["tags", "tags"],
  ["abstract", "abstract"], ["summary", "abstract"],
]);

/** @returns whether `key` is an operator of the query language, whatever its value */
export function isOperatorKey(key: string): boolean {
  return TAG_KEYS.has(key) || STATUS_KEYS.has(key) || YEAR_KEYS.has(key) || HAS_KEYS.has(key) || MISSING_KEYS.has(key)
    || FIELD_KEYS.has(key);
}
