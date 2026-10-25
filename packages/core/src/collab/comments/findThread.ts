// Places a comment thread in its file's current text, or reports it detached.
// CONTRACT: documents/contracts/collaboration.md#comments
import type { Text } from "yjs";
import { liveRange, type TextRange } from "./commentAnchor.js";
import type { CommentThread, CommentAnchor } from "./commentThread.js";

const SEED_LENGTH = 8;
const CONTEXT_SEED = 16;
const MIN_SIMILARITY = 0.7;

function occurrences(text: string, part: string): number[] {
  const found: number[] = [];
  if (part === "") { return found; }
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) { found.push(at); }
  return found;
}

function sharedEnd(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) { length += 1; }
  return length;
}

function sharedStart(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) { length += 1; }
  return length;
}

/** The exact occurrence of the quote whose surrounding text shares the most with the anchor's prefix and suffix. */
function exactMatch(text: string, anchor: CommentAnchor): TextRange | undefined {
  let best: { range: TextRange; score: number } | undefined;
  for (const start of occurrences(text, anchor.quote)) {
    const end = start + anchor.quote.length;
    const score = sharedEnd(text.slice(Math.max(0, start - anchor.prefix.length), start), anchor.prefix)
      + sharedStart(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    if (!best || score > best.score) { best = { range: { start, end }, score }; }
  }
  return best?.range;
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let at = 0; at < text.length - 1; at += 1) {
    const pair = text.slice(at, at + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Dice coefficient over character bigrams: 1 for equal strings, 0 for nothing in common. */
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) { return a === b ? 1 : 0; }
  const left = bigrams(a);
  let shared = 0;
  for (const [pair, count] of bigrams(b)) { shared += Math.min(count, left.get(pair) ?? 0); }
  return (2 * shared) / (a.length + b.length - 2);
}

// Candidates start where the quote's head occurs, end where its tail occurs, or sit between the prefix and suffix.
function candidates(text: string, anchor: CommentAnchor): TextRange[] {
  const { quote, prefix, suffix } = anchor;
  const seed = Math.min(SEED_LENGTH, quote.length);
  const ranges = occurrences(text, quote.slice(0, seed)).map((start) => ({ start, end: start + quote.length }));
  for (const at of occurrences(text, quote.slice(-seed))) { ranges.push({ start: at + seed - quote.length, end: at + seed }); }
  const prefixSeed = prefix.slice(-CONTEXT_SEED);
  for (const at of occurrences(text, prefixSeed)) {
    const start = at + prefixSeed.length;
    const end = suffix === "" ? start + quote.length : text.indexOf(suffix.slice(0, CONTEXT_SEED), start);
    if (end > start && end - start <= 2 * quote.length) { ranges.push({ start, end }); }
  }
  return ranges.filter((range) => range.start >= 0 && range.end <= text.length && range.start < range.end);
}

/** The candidate range most similar to the quote, when it is similar enough. */
function fuzzyMatch(text: string, anchor: CommentAnchor): TextRange | undefined {
  let best: { range: TextRange; score: number } | undefined;
  for (const range of candidates(text, anchor)) {
    const score = similarity(anchor.quote, text.slice(range.start, range.end));
    if (score >= MIN_SIMILARITY && (!best || score > best.score)) { best = { range, score }; }
  }
  return best?.range;
}

/**
 * Relative positions win when they span text, even edited text; then the exact quote, then an approximate one.
 * @param yText the file doc's text in a shared project, whose content is `text`
 */
export function locateThread(thread: CommentThread, text: string, yText?: Text): TextRange | "detached" {
  const live = yText ? liveRange(yText, thread.anchor) : undefined;
  return live ?? exactMatch(text, thread.anchor) ?? fuzzyMatch(text, thread.anchor) ?? "detached";
}
