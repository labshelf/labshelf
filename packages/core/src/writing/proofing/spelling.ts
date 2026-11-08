// What spelling accepts beside the dictionary, and the ranked corrections of a misspelled word: the accent-folded match
// first ("secoes" gives "seções"), then real-usage words by edit distance and frequency. The card's one suggestion and
// the Ctrl+Space list both read `rankCorrections`.
import type { SpellChecker } from "./checker.js";
import { lowerBound } from "./stems.js";
import type { FrequencyList } from "./wordRanking.js";

/** The lists a checker's corrections are ranked and filtered with. */
export interface CorrectionSources {
  /** The language's frequency list. */
  frequency?: FrequencyList | undefined;
  /** The dictionary's bare stems, in code-unit order. */
  stems?: readonly string[] | undefined;
}

/** What may accept a word the dictionary does not know. */
export interface AcceptanceSources {
  check(word: string): boolean;
  frequency?: FrequencyList | undefined;
  /** A second language's checker (English in a non-English document), asked only about words the first one flags. */
  secondary?: ((word: string) => boolean) | undefined;
  /** The accepted word the accent-folded form matches (see `accentMatch`); a list word with a more frequent one is a missing accent. */
  accentMatch?: ((word: string) => string | undefined) | undefined;
}

const HUNSPELL_LIMIT = 10;
const MIN_COMMON_LENGTH = 3;
const PLAIN = /^[a-z'-]*$/;
const INNER_CAPITAL = /\p{Ll}.*\p{Lu}/u;

/** The word without accents, cedilla or case: NFD with the combining marks removed, lower-cased. */
export function foldAccents(word: string): string {
  if (PLAIN.test(word)) return word;
  return word.replaceAll("’", "'").normalize("NFD").replace(/\p{M}+/gu, "").replaceAll("ç", "c").replaceAll("Ç", "C").toLocaleLowerCase();
}

/** The optimal-string-alignment Damerau-Levenshtein distance: insertions, deletions, substitutions and adjacent swaps. */
export function wordDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const rows: number[][] = [];
  for (let i = 0; i <= x.length; i += 1) rows.push([i, ...new Array<number>(y.length).fill(0)]);
  const row0 = rows[0]!;
  for (let j = 0; j <= y.length; j += 1) row0[j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    const row = rows[i]!;
    const up = rows[i - 1]!;
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(up[j]! + 1, row[j - 1]! + 1, up[j - 1]! + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      row[j] = best;
    }
  }
  return rows[x.length]![y.length]!;
}

/** How often the word occurs in the list, case-insensitively; 0 when it is not there. */
export function frequencyCount(list: FrequencyList | undefined, word: string): number {
  if (!list) return 0;
  const lower = word.replaceAll("’", "'").toLocaleLowerCase();
  const at = lowerBound(list.words, lower);
  return list.words[at] === lower ? list.counts[at] ?? 0 : 0;
}

function isStem(stems: readonly string[] | undefined, word: string): boolean {
  if (!stems) return false;
  const has = (value: string): boolean => stems[lowerBound(stems, value)] === value;
  return has(word) || has(word.toLocaleLowerCase());
}

/** Whether a word has a capital after a lower-case letter, like a product or package name (LabShelf, TikZ). */
export function hasInnerCapital(word: string): boolean {
  return INNER_CAPITAL.test(word);
}

/**
 * Whether spelling accepts `word`: the dictionary takes it, it is a product-style name with an inner capital, the
 * language's frequency list has it (three letters or more, and no accented spelling of it is more frequent: pt-BR
 * "nao" is in the list, "não" far above it), or the secondary checker takes it.
 */
export function acceptsWord(word: string, sources: AcceptanceSources): boolean {
  if (sources.check(word) || hasInnerCapital(word)) return true;
  const uses = [...word].length >= MIN_COMMON_LENGTH ? frequencyCount(sources.frequency, word) : 0;
  if (uses > 0) {
    const accented = sources.accentMatch?.(word);
    if (accented === undefined || frequencyCount(sources.frequency, accented) <= uses) return true;
  }
  return sources.secondary?.(word) ?? false;
}

/** Gives the correction the typed case: a capitalised word gets a capitalised correction, an upper-case word an upper-case one. */
export function matchCase(word: string, correction: string): string {
  const letters = [...word];
  const first = letters[0] ?? "";
  if (letters.length > 1 && word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase()) return correction.toLocaleUpperCase();
  if (first !== first.toLocaleLowerCase()) {
    const [head = "", ...rest] = [...correction];
    return head.toLocaleUpperCase() + rest.join("");
  }
  return correction;
}

const foldedIndexes = new WeakMap<SpellChecker, Map<string, string[]>>();
const rankedCache = new WeakMap<SpellChecker, Map<string, string[]>>();

/** Folded form to the words that fold to it and differ from it: frequency words by count first, then the stems. */
function foldedIndex(checker: SpellChecker, sources: CorrectionSources): Map<string, string[]> {
  let index = foldedIndexes.get(checker);
  if (index) return index;
  index = new Map();
  const add = (word: string): void => {
    const key = foldAccents(word);
    if (key === word) return;
    const list = index!.get(key);
    if (list) { if (!list.includes(word)) list.push(word); } else index!.set(key, [word]);
  };
  const { frequency, stems } = sources;
  if (frequency) {
    const order = frequency.words.map((_, i) => i).sort((a, b) => (frequency.counts[b] ?? 0) - (frequency.counts[a] ?? 0));
    for (const i of order) add(frequency.words[i] ?? "");
  }
  for (const stem of stems ?? []) add(stem);
  foldedIndexes.set(checker, index);
  return index;
}

/** The corrections already ranked for `word`, or undefined when they were not computed yet. */
export function cachedCorrections(checker: SpellChecker, word: string, limit = 8): string[] | undefined {
  return rankedCache.get(checker)?.get(word)?.slice(0, limit);
}

/**
 * The corrections of a misspelled word, best first, in the typed case: the accepted word its accent-folded form matches,
 * then Hunspell's and that match's words by distance on folded forms, then frequency, then Hunspell's order. A Hunspell
 * suggestion that is neither in the frequency list nor a bare stem (an affix form nobody writes) is dropped.
 */
export function rankCorrections(checker: SpellChecker, word: string, sources: CorrectionSources, limit = 8): string[] {
  let cache = rankedCache.get(checker);
  if (!cache) rankedCache.set(checker, (cache = new Map()));
  let ranked = cache.get(word);
  if (!ranked) cache.set(word, (ranked = computeCorrections(checker, word, sources)));
  return ranked.slice(0, limit);
}

/**
 * The most frequent other word, in lower case, that `word` folds to and the checker accepts ("secoes" gives "seções"),
 * from the frequency list and the stems; undefined when there is none.
 */
export function accentMatch(checker: SpellChecker, word: string, sources: CorrectionSources): string | undefined {
  const lower = word.toLocaleLowerCase();
  const key = foldAccents(word);
  const folded = [...(foldedIndex(checker, sources).get(key) ?? [])];
  if (key !== lower) folded.push(key);
  return folded
    .map((candidate, order) => ({ candidate, order, uses: frequencyCount(sources.frequency, candidate) }))
    .sort((a, b) => b.uses - a.uses || a.order - b.order)
    .find(({ candidate }) => candidate !== lower && candidate !== word && checker.check(candidate))?.candidate;
}

function computeCorrections(checker: SpellChecker, word: string, sources: CorrectionSources): string[] {
  // Hunspell ranks a capitalised word's corrections poorly ("Nao" gives "Ao"); its lower case is asked first.
  const lower = word.toLocaleLowerCase();
  const key = foldAccents(word);
  const count = (candidate: string): number => frequencyCount(sources.frequency, candidate);
  const match = accentMatch(checker, word, sources);

  let hunspell = checker.suggest(lower, HUNSPELL_LIMIT);
  if (hunspell.length === 0 && lower !== word) hunspell = checker.suggest(word, HUNSPELL_LIMIT);
  const real = hunspell.filter((candidate) => candidate.includes(" ") || count(candidate) > 0 || isStem(sources.stems, candidate));
  const rest = real
    .filter((candidate) => candidate !== match)
    .map((candidate, order) => ({ candidate, order, distance: wordDistance(key, foldAccents(candidate)), uses: count(candidate) }))
    .sort((a, b) => a.distance - b.distance || b.uses - a.uses || a.order - b.order)
    .map(({ candidate }) => candidate);

  const out: string[] = [];
  for (const candidate of match ? [match, ...rest] : rest) {
    const cased = matchCase(word, candidate);
    if (!out.includes(cased) && cased !== word) out.push(cased);
  }
  return out;
}
