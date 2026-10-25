/** Generates "authorYearWord" cite keys and claims them without collisions (the key is the paper id and folder name). */

import { normalizeText } from "../search/index.js";

// Title words that make a poor cite-key suffix.
const STOPWORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "by", "at", "is", "are"]);

export interface CiteKeyMetadata {
  authors?: string[] | undefined;
  year?: number | undefined;
  title?: string | undefined;
}

/** Lower-cased text reduced to ASCII letters and digits. */
export function deriveCiteKeySlug(text: string): string {
  return normalizeText(text).replace(/[^a-z0-9]/g, "");
}

/** "authorYearWord" cite key (vaswani2017attention); a timestamp key when the metadata has nothing to build from. */
export function createCiteKey(meta: CiteKeyMetadata, fallbackTitle: string): string {
  const lastName = deriveCiteKeySlug(meta.authors?.[0]?.trim().split(/\s+/).pop() ?? "");
  const year = meta.year ? String(meta.year) : "";
  const word = (meta.title ?? fallbackTitle)
    .split(/\s+/)
    .map(deriveCiteKeySlug)
    .find((w) => w.length > 1 && !STOPWORDS.has(w)) ?? "";
  return `${lastName}${year}${word}` || `paper${Date.now()}`;
}

/**
 * The key when free, otherwise key + a, b, … z, aa, … (BibTeX's convention). Comparison ignores case because the key
 * is a folder name and drives may fold case.
 */
export function deriveUniqueCiteKey(base: string, taken: ReadonlySet<string>): string {
  const takenLower = new Set([...taken].map((key) => key.toLowerCase()));
  if (!takenLower.has(base.toLowerCase())) { return base; }
  for (let i = 0; i < 26 * 26; i++) {
    const suffix = i < 26
      ? String.fromCharCode(97 + i)
      : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!takenLower.has(`${base}${suffix}`.toLowerCase())) { return `${base}${suffix}`; }
  }
  return `${base}${Date.now()}`;
}

/**
 * A key free among the known ids and on disk. A folder can exist without being a known paper (a sync in flight, an
 * orphan PDF folder), so each candidate is also checked with `folderExists`.
 */
export async function ensureCiteKey(
  base: string,
  takenIds: Iterable<string>,
  folderExists: (key: string) => Promise<boolean>,
): Promise<string> {
  const taken = new Set([...takenIds].map((id) => id.toLowerCase()));
  let key = deriveUniqueCiteKey(base, taken);
  while (await folderExists(key)) {
    taken.add(key.toLowerCase());
    key = deriveUniqueCiteKey(base, taken);
  }
  return key;
}
