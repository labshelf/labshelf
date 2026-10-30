// Defines a pending suggestion, reads one from untrusted JSON, anchors it in a file's text, finds it again after edits, gives the text of an accept or reject and keeps the suggestions of a shared project in its index doc's suggestions map.
// CONTRACT: documents/contracts/qmd-items.md#comments
// CONTRACT: documents/contracts/collaboration.md#comments
import * as Y from "yjs";
import { isNonEmptyString, isRecord } from "../guards/index.js";
import { decode, deriveAnchor, deriveLiveAnchor, findThread, occurrences, readAnchor, similarity, type CommentAnchor, type TextRange } from "./comments.js";
import type { ShareSession } from "./docSync.js";
import { readShareIndexDocSuggestions } from "./shareIndexDoc.js";
import { openListedText } from "./sharedFiles.js";

export type SuggestionKind = "insert" | "delete";

/** A proposal already applied to the file: an insert quotes the text it added; a delete marks a position and keeps the text it removed. */
export interface Suggestion {
  id: string;
  /** POSIX path of the text file, relative to the project folder. */
  file: string;
  kind: SuggestionKind;
  /** An insert quotes its text; a delete has an empty quote, its prefix and suffix marking the position. */
  anchor: CommentAnchor;
  /** The deleted text; present only on a delete, never empty. */
  text?: string;
  /** Shared by the delete and the insert of a replacement, which are accepted or rejected together. */
  group?: string;
  author: string;
  created: string;
}

/**
 * The file and the share come from other machines, so every key is checked.
 * @returns undefined when a key is missing or invalid, or the anchor and text do not fit the kind
 */
export function readSuggestion(value: unknown): Suggestion | undefined {
  if (!isRecord(value)) { return undefined; }
  const { id, file, kind, text, group, author, created } = value;
  const anchor = readAnchor(value["anchor"], { emptyQuote: true });
  if (!isNonEmptyString(id) || !isNonEmptyString(file) || (kind !== "insert" && kind !== "delete") || !anchor || !isNonEmptyString(author) || !isNonEmptyString(created)) {
    return undefined;
  }
  const grouped = isNonEmptyString(group) ? { group } : {};
  if (kind === "insert") {
    return anchor.quote !== "" && text === undefined ? { id, file, kind, anchor, ...grouped, author, created } : undefined;
  }
  return anchor.quote === "" && isNonEmptyString(text) ? { id, file, kind, anchor, text, ...grouped, author, created } : undefined;
}

/** An insert quotes `text[start, end)`; a delete gets an empty quote at `start` (`end` is ignored), both with the context around them. */
export function deriveSuggestionAnchor(text: string, kind: SuggestionKind, start: number, end: number): CommentAnchor {
  return kind === "insert" ? deriveAnchor(text, start, end) : deriveAnchor(text, start, start);
}

/** @returns the index the encoded relative position resolves to in `yText`, or undefined when it does not resolve there */
function decodeLive(yText: Y.Text, encoded: string | undefined): number | undefined {
  if (encoded === undefined) { return undefined; }
  try {
    return decode(yText, encoded);
  } catch {
    // TRAP: positions come from peers, so malformed bytes are expected input; the context takes over.
    return undefined;
  }
}

const CONTEXT_SEED = 16;
const MIN_OVERLAP = 0.7;

/** How much the text around `at` shares with the anchor's prefix and suffix, weighted by their lengths. */
function contextOverlap(text: string, anchor: CommentAnchor, at: number): number {
  const { prefix, suffix } = anchor;
  const before = similarity(prefix, text.slice(Math.max(0, at - prefix.length), at)) * prefix.length;
  const after = similarity(suffix, text.slice(at, at + suffix.length)) * suffix.length;
  return (before + after) / (prefix.length + suffix.length);
}

/** The position where the prefix ends and the suffix starts: exact, else the candidate with the best context overlap. */
function findDeletePosition(text: string, anchor: CommentAnchor): number | undefined {
  const { prefix, suffix } = anchor;
  if (prefix === "" && suffix === "") { return 0; }
  const exact = text.indexOf(prefix + suffix);
  if (exact !== -1) { return exact + prefix.length; }
  const prefixSeed = prefix.slice(-CONTEXT_SEED);
  const candidates = [
    ...occurrences(text, prefixSeed).map((at) => at + prefixSeed.length),
    ...occurrences(text, suffix.slice(0, CONTEXT_SEED)),
  ];
  let best: { at: number; score: number } | undefined;
  for (const at of candidates) {
    const score = contextOverlap(text, anchor, at);
    if (score >= MIN_OVERLAP && (!best || score > best.score)) { best = { at, score }; }
  }
  return best?.at;
}

/**
 * An insert is found as a thread is; a delete as an empty range at its position. Live relative positions win when `yText` is given.
 * @param yText the file doc's text in a shared project, whose content is `text`
 */
export function findSuggestion(suggestion: Suggestion, text: string, yText?: Y.Text): TextRange | "detached" {
  if (suggestion.kind === "insert") {
    return findThread({ id: suggestion.id, file: suggestion.file, anchor: suggestion.anchor, comments: [], resolved: false }, text, yText);
  }
  const live = yText ? decodeLive(yText, suggestion.anchor.start) : undefined;
  const at = live ?? findDeletePosition(text, suggestion.anchor);
  return at === undefined ? "detached" : { start: at, end: at };
}

/** Accept leaves the text; reject of an insert removes `range`, reject of a delete puts its text back at `range.start`. */
export function resolveSuggestionText(text: string, suggestion: Suggestion, range: TextRange, decision: "accept" | "reject"): string {
  if (decision === "accept") { return text; }
  if (suggestion.kind === "insert") { return text.slice(0, range.start) + text.slice(range.end); }
  return text.slice(0, range.start) + (suggestion.text ?? "") + text.slice(range.start);
}

/** Earliest created first, then by id, so every member lists and writes suggestions in one order. */
export function compareSuggestions(a: Suggestion, b: Suggestion): number {
  const byTime = Date.parse(a.created) - Date.parse(b.created);
  if (!Number.isNaN(byTime) && byTime !== 0) { return byTime; }
  if (Number.isNaN(byTime) && a.created !== b.created) { return a.created < b.created ? -1 : 1; }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// INVARIANT: a suggestion is one Y.Map whose every key is a plain value (the anchor is a plain object), so no key holds a nested shared type.
function suggestionMap(suggestion: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(suggestion)) {
    if (value !== undefined) { map.set(key, value); }
  }
  return map;
}

/** The valid suggestions in the order every member sees; entries that are not a suggestion map are skipped. */
export function readLiveSuggestions(doc: Y.Doc): Suggestion[] {
  const found: Suggestion[] = [];
  readShareIndexDocSuggestions(doc).forEach((value) => {
    const suggestion = value instanceof Y.Map ? readSuggestion(value.toJSON()) : undefined;
    if (suggestion) { found.push(suggestion); }
  });
  return found.sort(compareSuggestions);
}

/** Adds the suggestion unless the map holds one with its id; unknown keys of `suggestion` travel with it. */
export function addLiveSuggestion(doc: Y.Doc, suggestion: Suggestion | Record<string, unknown>): boolean {
  const map = readShareIndexDocSuggestions(doc);
  const id = suggestion["id"];
  if (typeof id !== "string" || map.has(id)) { return false; }
  map.set(id, suggestionMap(suggestion as Record<string, unknown>));
  return true;
}

/** Removes exactly the listed ids in one transaction; a group is not expanded. @returns how many the map held */
export function removeLiveSuggestions(doc: Y.Doc, ids: readonly string[]): number {
  const map = readShareIndexDocSuggestions(doc);
  let removed = 0;
  doc.transact(() => {
    for (const id of ids) {
      if (map.has(id)) { map.delete(id); removed += 1; }
    }
  });
  return removed;
}

export interface SharedProjectSuggestions {
  /** The valid suggestions, in the order every member sees. */
  suggestions(): Suggestion[];
  /** Where the suggestion sits in its file's current text (an empty range for a delete); detached also when the share lists no text file for it. */
  locate(suggestion: Suggestion): TextRange | "detached";
  /** The anchor of a range in a shared text file, with relative positions that follow concurrent edits; a delete anchors at `range.start`. Throws when the share lists no such text file. */
  anchor(file: string, kind: SuggestionKind, range: TextRange): CommentAnchor;
  /** Adds them all in one change. Throws, adding none, when the share already holds one of the ids. */
  add(suggestions: readonly Suggestion[]): void;
  /** Removes exactly the listed ids; unknown ids are ignored. */
  remove(ids: readonly string[]): void;
  /** Calls `listener` after every change of the suggestions, here or by a peer. */
  onChange(listener: () => void): () => void;
}

export function createSharedProjectSuggestions(session: Pick<ShareSession, "index" | "openDoc">): SharedProjectSuggestions {
  const { index } = session;
  const liveText = (file: string): Y.Text | undefined => openListedText(session, file);
  return {
    suggestions: () => readLiveSuggestions(index),
    locate(suggestion) {
      const yText = liveText(suggestion.file);
      return yText ? findSuggestion(suggestion, yText.toString(), yText) : "detached";
    },
    anchor(file, kind, range) {
      const yText = liveText(file);
      if (!yText) { throw new Error(`The share holds no text file ${file}, so a suggestion cannot be anchored in it`); }
      return deriveLiveAnchor(yText, range.start, kind === "insert" ? range.end : range.start);
    },
    add(suggestions) {
      const map = readShareIndexDocSuggestions(index);
      const taken = suggestions.find((each) => map.has(each.id));
      if (taken) { throw new Error(`The share already holds a suggestion with id ${taken.id}`); }
      index.transact(() => { suggestions.forEach((each) => addLiveSuggestion(index, each)); });
    },
    remove(ids) {
      removeLiveSuggestions(index, ids);
    },
    onChange(listener) {
      const map = readShareIndexDocSuggestions(index);
      const observer = (): void => { listener(); };
      map.observeDeep(observer);
      return () => map.unobserveDeep(observer);
    },
  };
}
