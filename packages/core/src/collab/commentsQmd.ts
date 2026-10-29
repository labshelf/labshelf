// Maps a project's comment threads to the items of .labshelf/comments.qmd and back, keeping unknown attributes, other items and text outside items on a rewrite.
// CONTRACT: documents/contracts/qmd-items.md#comments
import {
  ITEM_CLASS, extractLineContent, extractLineEnding, findUnclosedCodeFences, formatAnchor, formatDivOpener, isBalanced, parseDivOpener, parseItemFile,
  serializeItemFile, splitLines, type ItemAttributes, type ItemFile, type ItemSegment, type Segment,
} from "../qmd/item/index.js";
import { readThread, type Comment, type CommentThread } from "./comments.js";
import type { CommentsDocument } from "./commentsFile.js";

// The key of a parsed document that holds the file it was read from; absent when a plain rewrite gives the same text.
const SOURCE_KEY = "qmdSource";
// `comment` holds the first comment's own id when it differs from the thread id the first item carries.
const KNOWN_ATTRS = new Set(["comment", "anchor", "file", "resolved", "start", "end", "thread", "author", "created"]);
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
  return serializeCommentsQmd({ threads }) === text ? { threads } : { threads, [SOURCE_KEY]: file };
}

/** Writes the threads; a parsed document's unknown attributes, other items and loose text stay where they were. */
export function serializeCommentsQmd(doc: CommentsDocument): string {
  const source = readSource(doc);
  if (!source) { return joinItems(threadsToItems(doc.threads), "\n"); }
  const eol = extractLineEnding(serializeItemFile(source));
  const read = readComments(source);
  const previous = new Map<string, ItemSegment>();
  read.commentSegments.forEach((index) => {
    const item = source.segments[index] as ItemSegment;
    if (!previous.has(item.id)) { previous.set(item.id, item); }
  });
  const fresh = doc.threads.flatMap((thread) => thread.comments.map((comment, at) => commentItem(thread, comment, at === 0, eol, previous.get(at === 0 ? thread.id : comment.id))));
  // Each slot a comment held is filled by the next comment in order; the comments left over follow the last slot.
  const out: Segment[] = [];
  let next = 0;
  let afterLastSlot: number | undefined;
  source.segments.forEach((segment, index) => {
    if (!read.commentSegments.has(index)) {
      out.push(segment);
    } else if (next < fresh.length) {
      out.push(fresh[next++]!);
      afterLastSlot = out.length;
    }
  });
  const rest = fresh.slice(next);
  if (rest.length === 0) { return serializeItemFile({ segments: out }); }
  if (afterLastSlot !== undefined) {
    const before = serializeItemFile({ segments: out.slice(0, afterLastSlot) });
    return before + eol + joinItems(rest, eol) + serializeItemFile({ segments: out.slice(afterLastSlot) });
  }
  let head = serializeItemFile({ segments: out });
  if (head !== "") { head += TRAILING_EOL.test(head) ? eol : eol + eol; }
  return head + joinItems(rest, eol);
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
