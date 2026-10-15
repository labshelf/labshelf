/** Tells whether a registry's title-search hit contradicts what the page states, by a surname rule. */
import type { ResolvedMetadata } from "../metadata/index.js";
import { familyName, fold } from "../../library/index.js";

/**
 * A title search hit is accepted only when it does not contradict the page: same year (±1, for online-first vs
 * issue dates) and a shared author surname.
 */
export function agrees(found: ResolvedMetadata, page: ResolvedMetadata): boolean {
  if (found.year && page.year && Math.abs(found.year - page.year) > 1) return false;
  if (found.authors?.length && page.authors?.length) {
    const surnames = new Set(found.authors.map(surname));
    return page.authors.some((a) => surnames.has(surname(a)));
  }
  return true;
}

/** The author's family name, accent-folded and lower-cased; truncation marks ("Shor…") are dropped. */
export function surname(name: string): string {
  const folded = fold(familyName(name));
  return folded.replace(/[^a-z\s-]/g, " ").trim().split(/\s+/).pop() ?? "";
}
