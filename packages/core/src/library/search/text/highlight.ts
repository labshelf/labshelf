/** Finds where search terms occur in a text, comparing accent- and case-folded text but reporting positions in the original. */
import { normalizeText } from "./fold.js";

interface FoldedText {
  folded: string;
  /** Original index where each folded UTF-16 unit starts and ends. */
  from: number[];
  to: number[];
}

// Folding per code point keeps an index map back to the original, since folding can drop or merge characters.
function foldWithMap(text: string): FoldedText {
  const out: FoldedText = { folded: "", from: [], to: [] };
  let index = 0;
  for (const ch of text) {
    const piece = normalizeText(ch);
    for (let i = 0; i < piece.length; i++) {
      out.from.push(index);
      out.to.push(index + ch.length);
    }
    out.folded += piece;
    index += ch.length;
  }
  return out;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) { last[1] = Math.max(last[1], end); } else { merged.push([start, end]); }
  }
  return merged;
}

/**
 * Ranges of `text` (UTF-16 indices, end exclusive) covered by any term, ignoring case and accents so "cafe" marks
 * "Café". Overlapping and touching ranges are merged.
 * @returns sorted, non-overlapping ranges
 */
export function findHighlightRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  const { folded, from, to } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    const needle = normalizeText(term);
    if (!needle) { continue; }
    let at = folded.indexOf(needle);
    while (at !== -1) {
      let end = to[at + needle.length - 1]!;
      // A combining mark belongs to the letter before it.
      while (end < text.length && /\p{M}/u.test(text[end]!)) { end++; }
      ranges.push([from[at]!, end]);
      at = folded.indexOf(needle, at + needle.length);
    }
  }
  return mergeRanges(ranges);
}
