/**
 * Matches fzf-style subsequences for the jump pickers (collections, papers). Consecutive characters, word starts
 * and early matches score higher, so "atn" finds "Attention Is All You Need" before "Data anonymisation".
 */
import { normalizeText } from "./fold.js";

/**
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
