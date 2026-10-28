/** Folds and searches text: accent- and case-insensitive normalisation, fzf-style fuzzy matching for the jump pickers, and highlight ranges. */

/**
 * @returns the folded text
 */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * Matches fzf-style subsequences for the jump pickers (collections, papers). Consecutive characters, word starts
 * and early matches score higher, so "atn" finds "Attention Is All You Need" before "Data anonymisation".
 * @returns the score (higher is better), or undefined when the pattern is not a subsequence
 */
export function deriveFuzzyScore(pattern: string, text: string): { score: number } | undefined {
  const p = normalizeText(pattern).replace(/\s+/g, "");
  if (!p) { return { score: 0 }; }
  const t = normalizeText(text);
  let firstMatch = 0;
  let matched = 0;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of p) {
    const found = t.indexOf(ch, ti);
    if (found < 0) { return undefined; }
    const atWordStart = found === 0 || /[\s\-_/.:,(]/.test(t[found - 1] ?? "");
    streak = found === ti && matched > 0 ? streak + 1 : 0;
    score += 1 + streak * 3 + (atWordStart ? 4 : 0) - Math.min(found - ti, 10) * 0.2;
    if (matched === 0) { firstMatch = found; }
    matched++;
    ti = found + 1;
  }
  // Prefer shorter haystacks and earlier first matches.
  score -= firstMatch * 0.05 + t.length * 0.01;
  return { score };
}

/**
 * Filters and ranks items by fuzzy match against their label.
 * @returns matching items, best first (input order kept for an empty pattern)
 */
export function orderFuzzy<T>(items: readonly T[], pattern: string, label: (item: T) => string): T[] {
  if (!pattern.trim()) { return [...items]; }
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const match = deriveFuzzyScore(pattern, label(item));
    if (match) { scored.push({ item, score: match.score, index }); }
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

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
