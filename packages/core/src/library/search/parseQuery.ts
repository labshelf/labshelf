// Parses the search query language shared by the apps into a structured query.
import { fold } from "./text/index.js";
import {
  FIELD_KEYS, HAS_ALIASES, HAS_KEYS, MISSING_KEYS, STATUS_ALIASES, STATUS_KEYS, TAG_KEYS, YEAR_KEYS, isOperatorKey,
} from "./aliases.js";
import { emptyQuery, type Query } from "./query.js";
import { tokenize } from "./tokenize.js";
import { parseYearBounds } from "./year.js";

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
