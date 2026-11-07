// Completes the word before the caret on explicit completion (Ctrl+Space) inside prose: corrections for a misspelled word, then the document's own words and the dictionary's.
import { type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { findProseRanges, proseWords } from "../../proofing/index.js";
import { proofingStateOf } from "./proofing.js";

const WORD_BEFORE = /[\p{L}\p{M}'’-]+/u;
const WORD_CHAR = /[\p{L}\p{M}'’-]/u;
const WORD_PUNCTUATION = /['’-]/u;
const WORD_VALID_FOR = /^[\p{L}\p{M}'’-]*$/u;
/** A cite or ref command's open argument: another source completes keys and labels there. */
const KEY_ARGUMENT = /\\[A-Za-z]*(?:cite|ref)[A-Za-z]*\*?(?:\[[^\]]*\])*\{[^{}]*$/i;
const MARKUP_BEFORE = /[\\#@]/;

const CORRECTION_LIMIT = 8;
const DOCUMENT_LIMIT = 10;
// The dictionary lists its shortest words first, so a long word such as "computadores" needs a wide limit to reach the list.
const DICTIONARY_LIMIT = 400;
// A word of the document ranks above a correction: the caret may be in the middle of typing it.
const DOCUMENT_BOOST = 99;
const CORRECTION_BOOST = 80;

const isCapitalised = (word: string): boolean => word.charAt(0) !== word.charAt(0).toLocaleLowerCase();
const capitalise = (word: string): string => word.charAt(0).toLocaleUpperCase() + word.slice(1);

/** The document's prose words that start with `prefix`, the most used first and the typed one left out. */
function documentWords(text: string, ranges: readonly { from: number; to: number }[], prefix: string, typedFrom: number): string[] {
  const lowerPrefix = prefix.toLocaleLowerCase();
  const found = new Map<string, { count: number; form: string }>();
  for (const { from, word } of proseWords(text, ranges)) {
    const lower = word.toLocaleLowerCase();
    if (from === typedFrom || lower === lowerPrefix || !lower.startsWith(lowerPrefix)) continue;
    const entry = found.get(lower);
    if (entry) entry.count += 1;
    else found.set(lower, { count: 1, form: word });
  }
  // Map order is first appearance, and the sort is stable, so equal counts keep document order.
  return [...found.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, DOCUMENT_LIMIT).map(([lower, { form }]) => {
    if (isCapitalised(prefix)) return capitalise(lower);
    return form === capitalise(lower) ? lower : form;
  });
}

function option(label: string, boost: number): Completion {
  return { label, type: "text", boost: Math.max(-99, boost) };
}

/**
 * The word source of a LaTeX or Typst editor. It answers only on explicit completion, with the caret at the end of a
 * word inside prose, and only once the document's dictionary is ready; the command, citation and reference sources
 * keep everything else.
 */
export function createWordCompletion(format: "latex" | "typst"): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!context.explicit) return null;
    const proofing = proofingStateOf(context.state);
    const checker = proofing?.checker;
    if (!proofing || proofing.status !== "ready" || !checker) return null;
    const typed = context.matchBefore(WORD_BEFORE);
    if (!typed) return null;
    let from = typed.from;
    while (from < context.pos && WORD_PUNCTUATION.test(context.state.sliceDoc(from, from + 1))) from += 1;
    const prefix = context.state.sliceDoc(from, context.pos);
    if (prefix === "" || WORD_PUNCTUATION.test(prefix.slice(-1))) return null;
    if (MARKUP_BEFORE.test(context.state.sliceDoc(Math.max(0, from - 1), from))) return null;
    const line = context.state.doc.lineAt(context.pos);
    if (KEY_ARGUMENT.test(line.text.slice(0, context.pos - line.from))) return null;
    const text = context.state.doc.toString();
    const ranges = findProseRanges(format, text);
    if (!ranges.some((range) => range.from <= from && context.pos <= range.to)) return null;

    const wholeWord = !WORD_CHAR.test(context.state.sliceDoc(context.pos, context.pos + 1));
    const misspelled = wholeWord && !proofing.ignored.has(prefix) && !checker.check(prefix);
    const seen = new Set<string>([prefix.toLocaleLowerCase()]);
    const options: Completion[] = [];
    const add = (label: string, boost: number): void => {
      const key = label.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      options.push(option(label, boost));
    };

    documentWords(text, ranges, prefix, from).forEach((word, index) => add(word, DOCUMENT_BOOST - index));
    if (misspelled) checker.suggest(prefix, CORRECTION_LIMIT).forEach((word, index) => add(word, CORRECTION_BOOST - index));
    checker.complete(prefix, DICTIONARY_LIMIT).forEach((word) => add(isCapitalised(prefix) ? capitalise(word) : word, 0));
    if (options.length === 0) return null;
    return { from, options, validFor: WORD_VALID_FOR, ...(misspelled && { filter: false }) };
  };
}
