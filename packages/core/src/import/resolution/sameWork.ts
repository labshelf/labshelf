// Decides whether two bibliographic records describe the same work.
import { titleKey } from "../../library/index.js";
import { surname } from "./titleAgreement.js";

// TRAP: aggregators and title searches often return a neighbouring paper (BWA for BWA-SW), so a copy that did not
// come from the DOI's own record must pass this check before it is downloaded.

/** A record thin enough for the comparison: whatever a source managed to supply. */
export interface WorkRef {
  title?: string | undefined;
  year?: number | undefined;
  authors?: string[] | undefined;
}

export interface SameWorkOptions {
  /** Allowed absolute difference in publication year. Default 1; pass 2 for a preprint against its version of record. */
  yearSlack?: number;
}

// Below this two titles are different works. 0.9 keeps genuine variants together ("U-Net" vs "U Net") while
// splitting near neighbours such as BWA and BWA-SW, which score about 0.78 on word bigrams.
const TITLE_DICE_MIN = 0.9;

/**
 * Titles must be equal after normalisation or close by Dice coefficient, years must agree within the slack, and
 * when both sides list authors they must share a surname.
 * @returns true when `a` and `b` plausibly describe the same paper; false when either has no title.
 */
export function sameWork(a: WorkRef, b: WorkRef, opts: SameWorkOptions = {}): boolean {
  const ta = a.title ? titleKey(a.title) : "";
  const tb = b.title ? titleKey(b.title) : "";
  if (!ta || !tb) return false;
  if (ta !== tb && wordBigramDice(ta, tb) < TITLE_DICE_MIN) return false;

  const yearSlack = opts.yearSlack ?? 1;
  if (a.year !== undefined && b.year !== undefined && Math.abs(a.year - b.year) > yearSlack) return false;

  if (a.authors?.length && b.authors?.length) {
    const surnamesA = new Set(a.authors.map(surname).filter(Boolean));
    return b.authors.map(surname).some((s) => s !== "" && surnamesA.has(s));
  }
  return true;
}

/**
 * Dice coefficient over the adjacent word pairs of two normalised titles. Word pairs, not characters or single
 * words, are what separate near neighbours: single words score BWA against BWA-SW at 0.9 and would accept it.
 */
export function wordBigramDice(normA: string, normB: string): number {
  const a = wordBigrams(normA);
  const b = wordBigrams(normB);
  if (a.length === 0 || b.length === 0) return normA === normB ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of a) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of b) {
    const left = counts.get(g) ?? 0;
    if (left > 0) {
      overlap += 1;
      counts.set(g, left - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

// A one-word title falls back to that word so short titles still compare instead of scoring 0.
function wordBigrams(norm: string): string[] {
  const words = norm.split(" ").filter((w) => w.length > 0);
  if (words.length < 2) return words;
  return words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
}
