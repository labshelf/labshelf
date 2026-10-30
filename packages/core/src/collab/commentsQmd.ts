// Maps a project's comment threads and pending suggestions to the items of .labshelf/comments.qmd and back, keeping unknown attributes, other items and text outside items on a rewrite.
// CONTRACT: documents/contracts/qmd-items.md#comments
import {
  ITEM_CLASS, extractLineContent, extractLineEnding, findUnclosedCodeFences, formatAnchor, formatDivOpener, isBalanced, parseAnchor, parseDivOpener, parseItemFile,
  serializeItemFile, splitLines, type ItemAttributes, type ItemFile, type ItemSegment, type Segment,
} from "../qmd/item/index.js";
import { readThread, type Comment, type CommentThread } from "./comments.js";
import type { CommentsDocument } from "./commentsFile.js";
import { compareSuggestions, readSuggestion, type Suggestion } from "./suggestions.js";

// The key of a parsed document that holds the file it was read from; absent when a plain rewrite gives the same text.
const SOURCE_KEY = "qmdSource";
// `comment` holds the first comment's own id when it differs from the thread id the first item carries.
const KNOWN_ATTRS = new Set(["comment", "anchor", "file", "resolved", "start", "end", "thread", "author", "created", "suggestion", "group"]);
const CONFLICT_MARKER = /^(?:<{7}(?:[ \t].*)?|={7}|>{7}(?:[ \t].*)?)$/;
const TRAILING_EOL = /(?:\r\n|\n|\r)$/;

interface Read {
  threads: CommentThread[];
  /** Indices of the segments that hold a comment of `threads`. */
  commentSegments: Set<number>;
}

/** @returns undefined when text outside items holds git conflict markers; any other text parses, with zero threads when it holds no comment items */
export function parseCommentsQmd(text: string): CommentsDocument | undefined {
  const file = parseItemFile(text);
  if (file.segments.some((segment) => segment.kind === "loose" && splitLines(segment.text).some((line) => CONFLICT_MARKER.test(extractLineContent(line))))) {
    return undefined;
  }
  const { threads } = readComments(file);
  const { suggestions } = readSuggestionItems(file);
  return serializeCommentsQmd({ threads, suggestions }) === text ? { threads, suggestions } : { threads, suggestions, [SOURCE_KEY]: file };
}

/**
 * Writes the threads, then the suggestions sorted by created then id; a parsed document's unknown attributes, other items and loose text stay where they were.
 * Each slot a comment or suggestion held is filled by the next one of its kind in order; those left over follow the last slot of their kind, else the end of the file.
 */
export function serializeCommentsQmd(doc: CommentsDocument): string {
  const suggestions = [...(doc.suggestions ?? [])].sort(compareSuggestions);
  const source = readSource(doc);
  if (!source) { return joinItems([...threadsToItems(doc.threads), ...suggestions.map((each) => suggestionItem(each, "\n", undefined))], "\n"); }
  const eol = extractLineEnding(serializeItemFile(source));
  const read = readComments(source);
  const readSuggested = readSuggestionItems(source);
  const previous = previousItems(source, read.commentSegments);
  const previousSuggested = previousItems(source, readSuggested.segments);
  const kinds = [
    { slots: read.commentSegments, fresh: doc.threads.flatMap((thread) => thread.comments.map((comment, at) => commentItem(thread, comment, at === 0, eol, previous.get(at === 0 ? thread.id : comment.id)))), next: 0, after: undefined as number | undefined },
    { slots: readSuggested.segments, fresh: suggestions.map((each) => suggestionItem(each, eol, previousSuggested.get(each.id))), next: 0, after: undefined as number | undefined },
  ];
  const out: Segment[] = [];
  source.segments.forEach((segment, index) => {
    const kind = kinds.find((each) => each.slots.has(index));
    if (!kind) {
      out.push(segment);
    } else if (kind.next < kind.fresh.length) {
      out.push(kind.fresh[kind.next++]!);
      kind.after = out.length;
    }
  });
  const inserts = new Map<number, ItemSegment[]>();
  const tail: ItemSegment[] = [];
  for (const kind of kinds) {
    const rest = kind.fresh.slice(kind.next);
    if (rest.length === 0) { continue; }
    if (kind.after === undefined) { tail.push(...rest); } else { inserts.set(kind.after, rest); }
  }
  let text = "";
  out.forEach((segment, index) => {
    text += serializeItemFile({ segments: [segment] });
    const extra = inserts.get(index + 1);
    if (extra) { text += eol + joinItems(extra, eol); }
  });
  if (tail.length === 0) { return text; }
  if (text !== "") { text += TRAILING_EOL.test(text) ? eol : eol + eol; }
  return text + joinItems(tail, eol);
}

function previousItems(source: ItemFile, indices: ReadonlySet<number>): Map<string, ItemSegment> {
  const previous = new Map<string, ItemSegment>();
  indices.forEach((index) => {
    const item = source.segments[index] as ItemSegment;
    if (!previous.has(item.id)) { previous.set(item.id, item); }
  });
  return previous;
}

/** The valid suggestion items in file order, the first of an id winning, and the indices of their segments. */
function readSuggestionItems(file: ItemFile): { suggestions: Suggestion[]; segments: Set<number> } {
  const suggestions: Suggestion[] = [];
  const segments = new Set<number>();
  const seen = new Set<string>();
  file.segments.forEach((segment, index) => {
    if (segment.kind !== "item") { return; }
    const attrs = attributesOf(segment);
    const kind = attrs.get("suggestion");
    if (kind === undefined || seen.has(segment.id)) { return; }
    // A delete's quote is empty, which an item anchor allows only when asked to.
    const anchor = kind === "delete" ? parseAnchor(attrs.get("anchor"), { emptyQuote: true }) : segment.anchor;
    if (anchor.kind !== "quote") { return; }
    const { quote, prefix, suffix } = anchor;
    const start = attrs.get("start");
    const end = attrs.get("end");
    const body = segment.body.replace(TRAILING_EOL, "");
    const group = attrs.get("group");
    // An item that is not a valid suggestion stays in the file as an item this version cannot read.
    const suggestion = readSuggestion({
      id: segment.id, file: attrs.get("file"), kind,
      anchor: { quote, prefix, suffix, ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) },
      ...(kind === "delete" || body !== "" ? { text: body } : {}),
      ...(group === undefined ? {} : { group }),
      author: segment.author, created: segment.created,
    });
    if (!suggestion) { return; }
    seen.add(segment.id);
    suggestions.push(suggestion);
    segments.add(index);
  });
  return { suggestions, segments };
}

function suggestionItem(suggestion: Suggestion, eol: string, previous: ItemSegment | undefined): ItemSegment {
  const { anchor } = suggestion;
  const quote = { kind: "quote" as const, quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix };
  const attributes: ItemAttributes = {
    id: suggestion.id,
    classes: [ITEM_CLASS, ...(previous?.classes.filter((name) => name !== ITEM_CLASS) ?? [])],
    pairs: [
      ["suggestion", suggestion.kind], ["file", suggestion.file], ["anchor", formatAnchor(quote, { emptyQuote: suggestion.kind === "delete" })],
      ...(anchor.start !== undefined && anchor.end !== undefined ? [["start", anchor.start], ["end", anchor.end]] as [string, string][] : []),
      ...(suggestion.group === undefined ? [] : [["group", suggestion.group] as [string, string]]),
      ["author", suggestion.author], ["created", suggestion.created],
      ...(previous?.attrs.filter(([key]) => !KNOWN_ATTRS.has(key)) ?? []),
    ],
  };
  const body = suggestion.kind === "delete" ? (suggestion.text ?? "") + eol : "";
  const lines = splitLines(body);
  if (!isBalanced(lines) || findUnclosedCodeFences(lines).length > 0) {
    throw new Error(`Suggestion ${suggestion.id}: its deleted text opens or closes a block it does not close or open, so it cannot be written as an item`);
  }
  if (previous && previous.body === body && sameAttributes(parseDivOpener(extractLineContent(previous.fence)), attributes)) { return previous; }
  return {
    kind: "item",
    id: suggestion.id,
    anchor: quote,
    author: suggestion.author,
    created: suggestion.created,
    classes: attributes.classes,
    attrs: attributes.pairs,
    fence: formatDivOpener(attributes) + eol,
    body,
    close: `:::${eol}`,
  };
}

/** One item per comment, in thread order; the first comment of a thread carries the thread. Throws on a value that cannot be written. */
export function threadsToItems(threads: readonly CommentThread[]): ItemSegment[] {
  return threads.flatMap((thread) => thread.comments.map((comment, at) => commentItem(thread, comment, at === 0, "\n", undefined)));
}

function joinItems(items: readonly ItemSegment[], eol: string): string {
  return items.map((item) => item.fence + item.body + item.close).join(eol);
}

function readSource(doc: CommentsDocument): ItemFile | undefined {
  const source = doc[SOURCE_KEY] as ItemFile | undefined;
  return source && Array.isArray(source.segments) ? source : undefined;
}

function readComments(file: ItemFile): Read {
  const firsts: { id: string; index: number; thread: Record<string, unknown> }[] = [];
  const replies = new Map<string, { index: number; comment: Comment }[]>();
  file.segments.forEach((segment, index) => {
    if (segment.kind !== "item") { return; }
    const attrs = attributesOf(segment);
    // A suggestion item is never a comment, even when it does not read as a suggestion.
    if (attrs.has("suggestion")) { return; }
    const comment = { id: attrs.get("thread") === undefined ? attrs.get("comment") ?? segment.id : segment.id, author: segment.author, body: segment.body.replace(TRAILING_EOL, ""), createdAt: segment.created };
    const threadId = attrs.get("thread");
    if (threadId !== undefined) {
      replies.set(threadId, [...(replies.get(threadId) ?? []), { index, comment: comment as Comment }]);
      return;
    }
    if (segment.anchor.kind !== "quote") { return; }
    const { quote, prefix, suffix } = segment.anchor;
    const start = attrs.get("start");
    const end = attrs.get("end");
    firsts.push({
      id: segment.id, index,
      thread: {
        id: segment.id, file: attrs.get("file"), resolved: attrs.get("resolved") === "true", comments: [comment],
        anchor: { quote, prefix, suffix, ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) },
      },
    });
  });
  const threads: CommentThread[] = [];
  const commentSegments = new Set<number>();
  const seen = new Set<string>();
  for (const first of firsts) {
    if (seen.has(first.id)) { continue; }
    const own = replies.get(first.id) ?? [];
    const thread = readThread({ ...first.thread, comments: [...(first.thread["comments"] as unknown[]), ...own.map((each) => each.comment)] });
    // A thread whose first comment is invalid stays in the file as an item this version cannot read.
    if (!thread || thread.comments[0]?.id !== (first.thread["comments"] as Comment[])[0]!.id) { continue; }
    seen.add(first.id);
    threads.push(thread);
    commentSegments.add(first.index);
    // An invalid reply is left out of the thread and stays in the file as it is.
    const valid = new Set(thread.comments.map((each) => each.id));
    for (const reply of own) {
      if (valid.has(reply.comment.id)) { commentSegments.add(reply.index); }
    }
  }
  return { threads, commentSegments };
}

function attributesOf(item: ItemSegment): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [key, value] of item.attrs) { if (!attrs.has(key)) { attrs.set(key, value); } }
  return attrs;
}

function commentItem(thread: CommentThread, comment: Comment, first: boolean, eol: string, previous: ItemSegment | undefined): ItemSegment {
  const known: [string, string][] = first
    ? [
      ...(comment.id === thread.id ? [] : [["comment", comment.id] as [string, string]]),
      ["anchor", formatQuote(thread)], ["file", thread.file],
      ...(thread.resolved ? [["resolved", "true"] as [string, string]] : []),
      ...(thread.anchor.start !== undefined && thread.anchor.end !== undefined ? [["start", thread.anchor.start], ["end", thread.anchor.end]] as [string, string][] : []),
    ]
    : [["thread", thread.id]];
  const id = first ? thread.id : comment.id;
  const attributes: ItemAttributes = {
    id,
    classes: [ITEM_CLASS, ...(previous?.classes.filter((name) => name !== ITEM_CLASS) ?? [])],
    pairs: [...known, ["author", comment.author], ["created", comment.createdAt], ...(previous?.attrs.filter(([key]) => !KNOWN_ATTRS.has(key)) ?? [])],
  };
  const body = comment.body + eol;
  const lines = splitLines(body);
  if (!isBalanced(lines) || findUnclosedCodeFences(lines).length > 0) {
    throw new Error(`Comment ${comment.id}: its body opens or closes a block it does not close or open, so it cannot be written as an item`);
  }
  if (previous && previous.body === body && sameAttributes(parseDivOpener(extractLineContent(previous.fence)), attributes)) { return previous; }
  return {
    kind: "item",
    id,
    anchor: first ? { kind: "quote", quote: thread.anchor.quote, prefix: thread.anchor.prefix, suffix: thread.anchor.suffix } : { kind: "none" },
    author: comment.author,
    created: comment.createdAt,
    classes: attributes.classes,
    attrs: attributes.pairs,
    fence: formatDivOpener(attributes) + eol,
    body,
    close: `:::${eol}`,
  };
}

function formatQuote(thread: CommentThread): string {
  return formatAnchor({ kind: "quote", quote: thread.anchor.quote, prefix: thread.anchor.prefix, suffix: thread.anchor.suffix });
}

function sameAttributes(a: ItemAttributes | undefined, b: ItemAttributes): boolean {
  return a !== undefined && a.id === b.id && JSON.stringify(a.classes) === JSON.stringify(b.classes) && JSON.stringify(a.pairs) === JSON.stringify(b.pairs);
}
