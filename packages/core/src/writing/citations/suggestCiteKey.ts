// Suggests the shelf cite key an undefined key most likely meant, ranking by edit distance and author/year overlap.
import { deriveCiteKeySlug } from "../../library/paper/index.js";

export interface SuggestableKey {
  key: string;
  authors: string[];
  year?: string;
}

const SURNAME_BONUS = 0.15;
const YEAR_BONUS = 0.1;
// Below this score a key is unrelated: one edit in a 20-letter key scores 0.95 before any bonus.
const MIN_SCORE = 0.8;

/** The shelf key the undefined `missing` most likely meant, or undefined when no key is close; ties go to the key that sorts first. */
export function suggestKey(missing: string, keys: readonly SuggestableKey[]): string | undefined {
  const wanted = missing.toLowerCase();
  if (wanted === "") { return undefined; }
  const surname = leadingLetters(wanted);
  const year = /(?:19|20)\d\d/.exec(wanted)?.[0];
  let best: { key: string; score: number } | undefined;
  for (const candidate of keys) {
    const score = scoreOf(wanted, surname, year, candidate);
    if (score === undefined || score < MIN_SCORE) { continue; }
    if (!best || score > best.score || (score === best.score && candidate.key < best.key)) { best = { key: candidate.key, score }; }
  }
  return best?.key;
}

/** Undefined when the missing key names another author than both the candidate's key and its first author. */
function scoreOf(wanted: string, surname: string, year: string | undefined, candidate: SuggestableKey): number | undefined {
  const key = candidate.key.toLowerCase();
  const authorSurname = deriveCiteKeySlug(candidate.authors[0]?.trim().split(/\s+/).pop() ?? "");
  const authorMatches = surname !== "" && authorSurname !== "" && closeSurname(surname, authorSurname);
  if (surname !== "" && !authorMatches && !closeSurname(surname, leadingLetters(key))) { return undefined; }
  const similarity = 1 - editDistance(wanted, key) / Math.max(wanted.length, key.length);
  return similarity + (authorMatches ? SURNAME_BONUS : 0) + (year !== undefined && year === candidate.year ? YEAR_BONUS : 0);
}

function leadingLetters(key: string): string {
  return /^[a-z]+/.exec(key)?.[0] ?? "";
}

/** A typo or two, scaled to the surname's length. */
function closeSurname(a: string, b: string): boolean {
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
}

/** Levenshtein distance over UTF-16 code units. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(substitution, previous[j]! + 1, current[j - 1]! + 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}
