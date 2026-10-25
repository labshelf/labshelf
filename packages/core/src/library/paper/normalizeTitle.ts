/** Reduces a title to an accent-, case- and punctuation-insensitive key, for matching the same paper across sources. */
import { normalizeText } from "../search/index.js";

export function normalizeTitleForMatch(title: string): string {
  return normalizeText(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
