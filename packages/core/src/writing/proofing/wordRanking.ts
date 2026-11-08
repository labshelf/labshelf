// Ranks the one completion of the word being typed: a unigram frequency list (FrequencyWords, OpenSubtitles 2018,
// `word count` lines) searched by prefix, plus strong boosts from the current document's own words and word pairs.
import { decode, lowerBound } from "./stems.js";

/** A frequency list's words, lower-cased and in code-unit order, with their counts at the same index. */
export interface FrequencyList { readonly words: readonly string[]; readonly counts: Float64Array }

export interface RankingSources {
  /** The language's frequency list; without it only the document's words complete. */
  frequency?: FrequencyList | undefined;
  /** Whether a dictionary word, in the typed case, is spelled right; document words need no check. */
  accept(word: string): boolean;
}

/** The document's prose words in order, and the index of the word being typed (-1 when it is not among them). */
export interface RankingContext { readonly words: readonly string[]; readonly at: number }

const MIN_PREFIX = 3;
// Scores are log(1 + count) plus the boosts: one use in the document weighs like a word ~1100 times as frequent, so a
// word used twice beats any dictionary word; a pair seen in the document lifts a word further.
const DOCUMENT_WEIGHT = 7;
const DOCUMENT_CAP = 3;
const PAIR_WEIGHT = 5;
const PAIR_CAP = 2;
// The best candidate must score this far above the runner-up, about twice as frequent, to be shown.
const MARGIN = Math.log(2);
// The checker runs only on the best-scored dictionary words, until two are accepted or this many were tried.
const MAX_CHECKS = 40;

const normalise = (word: string): string => word.replaceAll("’", "'").toLocaleLowerCase();

/** Reads a `word count` list; malformed lines are skipped and a repeated word keeps the sum of its counts. */
export function parseFrequencyList(data: Uint8Array | string): FrequencyList {
  const byWord = new Map<string, number>();
  for (const line of (typeof data === "string" ? data.replace(/^\uFEFF/, "") : decode(data)).split(/\r?\n/)) {
    const space = line.lastIndexOf(" ");
    if (space <= 0) continue;
    const count = Number(line.slice(space + 1));
    const word = normalise(line.slice(0, space).trim());
    if (!word || !Number.isFinite(count) || count <= 0) continue;
    byWord.set(word, (byWord.get(word) ?? 0) + count);
  }
  const words = [...byWord.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { words, counts: Float64Array.from(words, (word) => byWord.get(word) ?? 0) };
}

function typedCase(prefix: string, word: string): string {
  const upper = prefix.toLocaleUpperCase();
  if (prefix.length >= 2 && prefix === upper && prefix !== prefix.toLocaleLowerCase()) return word.toLocaleUpperCase();
  const first = prefix.charAt(0);
  if (first !== first.toLocaleLowerCase()) return word.charAt(0).toLocaleUpperCase() + word.slice(1);
  return word;
}

interface Candidate { word: string; score: number; known: boolean }

/** How often each word starting with `prefix` occurs in the document, and how often it follows `previous`; the typed word is left out. */
function documentCounts(context: RankingContext, prefix: string): { uses: Map<string, number>; pairs: Map<string, number> } {
  const uses = new Map<string, number>();
  const pairs = new Map<string, number>();
  const previous = context.at > 0 ? normalise(context.words[context.at - 1] ?? "") : "";
  let before = "";
  context.words.forEach((raw, index) => {
    const word = normalise(raw);
    if (index !== context.at && word.length > prefix.length && word.startsWith(prefix)) {
      uses.set(word, (uses.get(word) ?? 0) + 1);
      if (previous && before === previous && index - 1 !== context.at) pairs.set(word, (pairs.get(word) ?? 0) + 1);
    }
    before = index === context.at ? "" : word;
  });
  return { uses, pairs };
}

/**
 * The best completion of `prefix`, the whole word in the typed case, or null: for a prefix under three letters, when
 * nothing completes it, or when the best word is not clearly ahead of the next. Dictionary words come from the
 * frequency list (binary search over its sorted words) and count only when `accept` takes them or the document uses them.
 */
export function rankCompletion(prefix: string, context: RankingContext, sources: RankingSources): string | null {
  if ([...prefix].length < MIN_PREFIX) return null;
  const lower = normalise(prefix);
  const { uses, pairs } = documentCounts(context, lower);
  const boost = (word: string): number => DOCUMENT_WEIGHT * Math.min(uses.get(word) ?? 0, DOCUMENT_CAP) + PAIR_WEIGHT * Math.min(pairs.get(word) ?? 0, PAIR_CAP);
  const candidates = new Map<string, Candidate>();
  const { frequency } = sources;
  if (frequency) {
    for (let i = lowerBound(frequency.words, lower); i < frequency.words.length; i += 1) {
      const word = frequency.words[i] ?? "";
      if (!word.startsWith(lower)) break;
      if (word.length <= lower.length) continue;
      candidates.set(word, { word, score: Math.log1p(frequency.counts[i] ?? 0) + boost(word), known: uses.has(word) });
    }
  }
  for (const word of uses.keys()) if (!candidates.has(word)) candidates.set(word, { word, score: boost(word), known: true });

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  let checks = 0;
  for (const candidate of ranked) {
    if (kept.length === 2) break;
    if (candidate.known) { kept.push(candidate); continue; }
    if (checks >= MAX_CHECKS) continue;
    checks += 1;
    if (sources.accept(typedCase(prefix, candidate.word))) kept.push(candidate);
  }
  const [best, next] = kept;
  if (!best || (next && best.score - next.score < MARGIN)) return null;
  return typedCase(prefix, best.word);
}
