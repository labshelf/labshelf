// Defines a comment thread, reads one from untrusted JSON, anchors it to a range of text (from an editor selection or a review note's line), places it in a file's current text and keeps the threads of a shared project in its index doc's comments map.
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
// CONTRACT: documents/contracts/collaboration.md#comments
import * as Y from "yjs";
import { base64ToBytes } from "../encoding/index.js";
import { isNonEmptyString, isRecord, isTimestamp } from "../guards/index.js";
import { deriveLineOffsets, findLineOfOffset } from "../text/index.js";
import { encodeRelativePosition } from "./cursors.js";
import { readShareIndexDocComments } from "./shareIndexDoc.js";

/** The text a thread is on; `start` and `end` are base64 Yjs relative positions, present only in a shared project. */
export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start?: string;
  end?: string;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  /** POSIX path of the text file, relative to the project folder. */
  file: string;
  anchor: CommentAnchor;
  /** Oldest first, never empty. */
  comments: Comment[];
  resolved: boolean;
}

function readAnchor(value: unknown): CommentAnchor | undefined {
  if (!isRecord(value)) { return undefined; }
  const { quote, prefix, suffix, start, end } = value;
  if (!isNonEmptyString(quote) || typeof prefix !== "string" || typeof suffix !== "string") { return undefined; }
  const live = isNonEmptyString(start) && isNonEmptyString(end) ? { start, end } : {};
  return { quote, prefix, suffix, ...live };
}

function readComment(value: unknown): Comment | undefined {
  if (!isRecord(value)) { return undefined; }
  const { id, author, body, createdAt } = value;
  return isNonEmptyString(id) && isNonEmptyString(author) && isNonEmptyString(body) && isTimestamp(createdAt) ? { id, author, body, createdAt } : undefined;
}

/**
 * The file and the share come from other machines, so every key is checked.
 * @returns undefined when a key of the thread is missing or invalid; invalid comments are left out
 */
export function readThread(value: unknown): CommentThread | undefined {
  if (!isRecord(value)) { return undefined; }
  const { id, file, resolved } = value;
  const anchor = readAnchor(value["anchor"]);
  if (!isNonEmptyString(id) || !isNonEmptyString(file) || typeof resolved !== "boolean" || !anchor || !Array.isArray(value["comments"])) { return undefined; }
  const comments = value["comments"].map(readComment).filter((each): each is Comment => each !== undefined);
  return comments.length === 0 ? undefined : { id, file, anchor, comments, resolved };
}

/** Earliest first comment first, then by id, so every member lists and writes threads in one order. */
export function compareThreads(a: CommentThread, b: CommentThread): number {
  const byTime = Date.parse(a.comments[0]!.createdAt) - Date.parse(b.comments[0]!.createdAt);
  return byTime !== 0 ? byTime : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const CONTEXT_LENGTH = 32;

/** A range of text, in UTF-16 offsets, `end` exclusive. */
export interface TextRange { start: number; end: number }

export function deriveAnchor(text: string, start: number, end: number): CommentAnchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  };
}

/** The anchor of a range in a shared file's text, with relative positions that follow concurrent edits. */
// `start` binds to the character after it and `end` to the one before, so text typed at an edge stays outside.
export function deriveLiveAnchor(yText: Y.Text, start: number, end: number): CommentAnchor {
  return { ...deriveAnchor(yText.toString(), start, end), start: encodeRelativePosition(yText, start), end: encodeRelativePosition(yText, end, -1) };
}

function decode(yText: Y.Text, encoded: string): number | undefined {
  if (!yText.doc) { return undefined; }
  const position = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(base64ToBytes(encoded)), yText.doc);
  // A position into another type of the doc is not a position in this text.
  return position && position.type === yText ? position.index : undefined;
}

/** @returns undefined when the anchor has no relative positions, they are unreadable, or the range they span is empty */
function deriveLiveRange(yText: Y.Text, anchor: CommentAnchor): TextRange | undefined {
  if (anchor.start === undefined || anchor.end === undefined) { return undefined; }
  try {
    const start = decode(yText, anchor.start);
    const end = decode(yText, anchor.end);
    return start !== undefined && end !== undefined && start < end ? { start, end } : undefined;
  } catch {
    // TRAP: positions come from peers, so malformed bytes are expected input, not a bug; the quote takes over.
    return undefined;
  }
}

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
export function findThread(thread: CommentThread, text: string, yText?: Y.Text): TextRange | "detached" {
  const live = yText ? deriveLiveRange(yText, thread.anchor) : undefined;
  return live ?? exactMatch(text, thread.anchor) ?? fuzzyMatch(text, thread.anchor) ?? "detached";
}

// INVARIANT: every key of a thread is a plain value except `comments`, a Y.Array, so concurrent replies merge.
function threadMap(thread: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(thread)) {
    map.set(key, key === "comments" && Array.isArray(value) ? Y.Array.from(value) : value);
  }
  return map;
}

/** Each thread as the plain JSON a client wrote, unknown keys included; entries that are not a thread map are skipped. */
function readRawLiveThreads(doc: Y.Doc): Record<string, unknown>[] {
  const threads: Record<string, unknown>[] = [];
  readShareIndexDocComments(doc).forEach((value) => { if (value instanceof Y.Map) { threads.push(value.toJSON()); } });
  return threads;
}

/** The valid threads in the order every member sees. */
export function readLiveThreads(doc: Y.Doc): CommentThread[] {
  return readRawLiveThreads(doc).map(readThread).filter((each): each is CommentThread => each !== undefined).sort(compareThreads);
}

/** Adds the thread unless the map holds one with its id; unknown keys of `thread` travel with it. */
export function addLiveThread(doc: Y.Doc, thread: CommentThread | Record<string, unknown>): boolean {
  const comments = readShareIndexDocComments(doc);
  const id = thread["id"];
  if (typeof id !== "string" || comments.has(id)) { return false; }
  comments.set(id, threadMap(thread as Record<string, unknown>));
  return true;
}

function liveThread(doc: Y.Doc, threadId: string): Y.Map<unknown> | undefined {
  const value = readShareIndexDocComments(doc).get(threadId);
  return value instanceof Y.Map ? value : undefined;
}

/** @returns false when the map holds no such thread */
export function addLiveThreadReply(doc: Y.Doc, threadId: string, comment: Comment): boolean {
  const comments = liveThread(doc, threadId)?.get("comments");
  if (!(comments instanceof Y.Array)) { return false; }
  comments.push([comment]);
  return true;
}

/** Resolves the thread, or reopens it when `resolved` is false. @returns false when the map holds no such thread */
export function setLiveThreadResolved(doc: Y.Doc, threadId: string, resolved: boolean): boolean {
  const thread = liveThread(doc, threadId);
  if (!thread) { return false; }
  thread.set("resolved", resolved);
  return true;
}

/** A zero-based line and character, the same in a file with CRLF and in its LF-normalized shared text. */
export interface LinePosition { line: number; character: number }

// How many lines around a SyncTeX line a PDF quote is searched in, since SyncTeX names the line a paragraph ends on.
const QUOTE_WINDOW = 3;

/** The offset just before a line's break, so a CRLF line ends before its `\r`. */
function endOfLineOffset(text: string, starts: readonly number[], line: number): number {
  const next = starts[line + 1];
  if (next === undefined) { return text.length; }
  return text[next - 2] === "\r" ? next - 2 : next - 1;
}

export function deriveOffset(text: string, { line, character }: LinePosition): number {
  const starts = deriveLineOffsets(text);
  const row = Math.min(Math.max(line, 0), starts.length - 1);
  return Math.min(starts[row]! + Math.max(character, 0), endOfLineOffset(text, starts, row));
}

export function derivePosition(text: string, offset: number): LinePosition {
  const starts = deriveLineOffsets(text);
  const line = findLineOfOffset(starts, offset);
  return { line, character: offset - starts[line]! };
}

/** The range without the whitespace at its edges; undefined when only whitespace is left. */
function trimmed(text: string, start: number, end: number): TextRange | undefined {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from]!)) { from += 1; }
  while (to > from && /\s/.test(text[to - 1]!)) { to -= 1; }
  return from < to ? { start: from, end: to } : undefined;
}

/**
 * The text a thread made in the editor anchors to: the selection, or its whole lines when it is empty.
 * @returns undefined when that text is only whitespace
 */
export function createEditorCommentRange(text: string, from: LinePosition, to: LinePosition): TextRange | undefined {
  const start = deriveOffset(text, from);
  const end = deriveOffset(text, to);
  if (start < end) { return trimmed(text, start, end); }
  const starts = deriveLineOffsets(text);
  return trimmed(text, starts[Math.min(from.line, starts.length - 1)]!, endOfLineOffset(text, starts, Math.min(to.line, starts.length - 1)));
}

/**
 * The text a review note anchors to: the quote on the nearest line around `line` that holds it, else that line itself.
 * @param line counts from 1, as SyncTeX does
 * @returns undefined when the line is past the end of the text or blank
 */
export function findSourceCommentRange(text: string, line: number, quote: string): TextRange | undefined {
  const starts = deriveLineOffsets(text);
  const row = line - 1;
  if (row < 0 || row >= starts.length) { return undefined; }
  const needle = quote.trim();
  for (let distance = 0; needle && distance <= QUOTE_WINDOW; distance += 1) {
    for (const candidate of distance === 0 ? [row] : [row - distance, row + distance]) {
      if (candidate < 0 || candidate >= starts.length) { continue; }
      const found = text.slice(starts[candidate], endOfLineOffset(text, starts, candidate)).indexOf(needle);
      if (found !== -1) { return { start: starts[candidate]! + found, end: starts[candidate]! + found + needle.length }; }
    }
  }
  return trimmed(text, starts[row]!, endOfLineOffset(text, starts, row));
}
