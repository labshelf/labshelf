/** Reduces a title to an accent-, case- and punctuation-insensitive key, for matching the same paper across sources. */
import { fold } from "../search/index.js";

export function titleKey(title: string): string {
  return fold(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
