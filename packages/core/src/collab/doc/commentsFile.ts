// Parses, edits and serializes a project's .labshelf/comments.json, loads it through an injected file access, syncs it with a share's comments map and runs the comment lifecycle of a shared project.
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
// CONTRACT: documents/contracts/collaboration.md#comments
import type * as Y from "yjs";
import { parseJsonObject } from "../../json/index.js";
import { isRecord } from "../../guards/index.js";
import { deriveLiveAnchor, findThread, readThread, compareThreads, addLiveThread, readLiveThreads, addLiveThreadReply, readRawLiveThreads, setLiveThreadResolved, type Comment, type CommentAnchor, type CommentThread, type TextRange } from "./comments.js";
import type { ShareSession } from "./docSync.js";
import { readShareIndexDocComments, readShareIndexDocFiles } from "./shareIndexDoc.js";
import { readFileText } from "./sharedFiles.js";

export const COMMENTS_PATH = ".labshelf/comments.json";

/** The whole file: invalid threads and unknown keys are carried so a rewrite loses nothing. */
export interface CommentsDocument {
  [key: string]: unknown;
  threads: readonly unknown[];
}

/** @returns undefined when the text is not a JSON object with a `threads` array, conflict markers included */
export function parseCommentsFile(text: string): CommentsDocument | undefined {
  const raw = parseJsonObject(text);
  return raw !== undefined && Array.isArray(raw["threads"]) ? raw as CommentsDocument : undefined;
}

const THREAD_KEYS = ["id", "file", "anchor", "comments", "resolved"];
const ANCHOR_KEYS = ["quote", "prefix", "suffix", "start", "end"];
const COMMENT_KEYS = ["id", "author", "body", "createdAt"];

// Members write the same threads from maps whose key order differs, so the known keys always come first, in order.
function ordered(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) { return value; }
  const known = keys.filter((key) => key in value).map((key) => [key, value[key]]);
  return Object.fromEntries([...known, ...Object.entries(value).filter(([key]) => !keys.includes(key))]);
}

function orderedThread(value: unknown): unknown {
  const thread = ordered(value, THREAD_KEYS);
  if (!isRecord(thread)) { return thread; }
  const comments = thread["comments"];
  return {
    ...thread,
    ...("anchor" in thread ? { anchor: ordered(thread["anchor"], ANCHOR_KEYS) } : {}),
    ...(Array.isArray(comments) ? { comments: comments.map((each) => ordered(each, COMMENT_KEYS)) } : {}),
  };
}

export function serializeCommentsFile(doc: CommentsDocument): string {
  return `${JSON.stringify({ ...doc, threads: doc.threads.map(orderedThread) }, null, 2)}\n`;
}

/** @returns the valid threads in file order, each with its valid comments */
export function deriveCommentThreads(doc: CommentsDocument): CommentThread[] {
  return doc.threads.map(readThread).filter((each): each is CommentThread => each !== undefined);
}

export function addThread(doc: CommentsDocument, thread: CommentThread): CommentsDocument {
  return { ...doc, threads: [...doc.threads, thread] };
}

// Only a valid thread is edited, so an entry this version cannot read stays exactly as written.
function editThread(doc: CommentsDocument, id: string, edit: (thread: Record<string, unknown>) => Record<string, unknown>): CommentsDocument {
  return { ...doc, threads: doc.threads.map((each) => (isRecord(each) && each["id"] === id && readThread(each) ? edit(each) : each)) };
}

export function addThreadReply(doc: CommentsDocument, threadId: string, comment: Comment): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, comments: [...(thread["comments"] as unknown[]), comment] }));
}

/** Resolves the thread, or reopens it when `resolved` is false. */
export function setThreadResolved(doc: CommentsDocument, threadId: string, resolved: boolean): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, resolved }));
}

/** Reads and writes the text of one comments.json; the adapter creates missing folders on write. */
export interface CommentsFileAccess {
  /** The file's text, or undefined when there is none. */
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** @returns the document (empty when the file is missing), or undefined when the file is not valid */
export async function loadCommentsDocument(access: CommentsFileAccess): Promise<CommentsDocument | undefined> {
  const text = await access.read();
  return text === undefined ? { threads: [] } : parseCommentsFile(text);
}

/** Applies `change` to a fresh read, so an edit made elsewhere since the last load is kept. */
export async function updateCommentsDocument(access: CommentsFileAccess, change: (doc: CommentsDocument) => CommentsDocument): Promise<void> {
  const doc = await loadCommentsDocument(access);
  if (!doc) { throw new Error(`${COMMENTS_PATH} is not valid JSON with a threads list, so it is left as it is`); }
  await access.write(serializeCommentsFile(change(doc)));
}

/**
 * The map's threads in member order, then the entries of `existing` that are not valid threads, under its other keys.
 * @param existing the current file's text, undefined when there is none
 * @returns undefined when `existing` is not a valid comments.json, which is never overwritten
 */
export function renderCommentsFile(doc: Y.Doc, existing: string | undefined): string | undefined {
  const current: CommentsDocument | undefined = existing === undefined ? { threads: [] } : parseCommentsFile(existing);
  if (!current) { return undefined; }
  const threads = readRawLiveThreads(doc)
    .map((raw) => ({ raw, thread: readThread(raw) }))
    .filter((each): each is { raw: Record<string, unknown>; thread: CommentThread } => each.thread !== undefined)
    .sort((a, b) => compareThreads(a.thread, b.thread))
    .map((each) => each.raw);
  return serializeCommentsFile({ ...current, threads: [...threads, ...current.threads.filter((each) => !readThread(each))] });
}

/**
 * Adds the file's valid threads, unknown keys included, that the map does not hold.
 * @returns how many were added, or undefined when the text is not a valid comments.json
 */
export function importCommentsFile(doc: Y.Doc, text: string): number | undefined {
  const file = parseCommentsFile(text);
  if (!file) { return undefined; }
  let added = 0;
  doc.transact(() => {
    for (const entry of file.threads) {
      if (readThread(entry) && addLiveThread(doc, entry as Record<string, unknown>)) { added += 1; }
    }
  });
  return added;
}

export interface SharedProjectComments {
  /** The valid threads, in the order every member sees. */
  threads(): CommentThread[];
  /** The file's current text; undefined when the share lists no text file at `file`. */
  textOf(file: string): string | undefined;
  /** Where the thread sits in its file's current text; detached also when the share lists no text file for it. */
  locate(thread: CommentThread): TextRange | "detached";
  /** The anchor of a range in a shared text file, with relative positions that follow concurrent edits. */
  anchor(file: string, range: TextRange): CommentAnchor;
  /** Throws when the share already holds a thread with its id. */
  add(thread: CommentThread): void;
  /** Throws when the share holds no such thread. */
  reply(threadId: string, comment: Comment): void;
  /** Throws when the share holds no such thread. */
  setResolved(threadId: string, resolved: boolean): void;
  /** Calls `listener` after every change of the threads, here or by a peer. */
  onChange(listener: () => void): () => void;
}

export function createSharedProjectComments(session: Pick<ShareSession, "index" | "openDoc">): SharedProjectComments {
  const { index } = session;
  // INVARIANT: only a listed text file is opened, so a thread naming another path never creates a doc for it.
  const liveText = (file: string): Y.Text | undefined => (readShareIndexDocFiles(index).get(file)?.kind === "text" ? readFileText(session.openDoc(file)) : undefined);
  const requireText = (file: string): Y.Text => {
    const yText = liveText(file);
    if (!yText) { throw new Error(`The share holds no text file ${file}, so a comment cannot be anchored in it`); }
    return yText;
  };
  const missing = (threadId: string): Error => new Error(`The share holds no comment thread ${threadId}`);
  return {
    threads: () => readLiveThreads(index),
    textOf: (file) => liveText(file)?.toString(),
    locate(thread) {
      const yText = liveText(thread.file);
      return yText ? findThread(thread, yText.toString(), yText) : "detached";
    },
    anchor: (file, range) => deriveLiveAnchor(requireText(file), range.start, range.end),
    add(thread) {
      if (!addLiveThread(index, thread)) { throw new Error(`The share already holds a comment thread with id ${thread.id}`); }
    },
    reply(threadId, comment) {
      if (!addLiveThreadReply(index, threadId, comment)) { throw missing(threadId); }
    },
    setResolved(threadId, resolved) {
      if (!setLiveThreadResolved(index, threadId, resolved)) { throw missing(threadId); }
    },
    onChange(listener) {
      const comments = readShareIndexDocComments(index);
      const observer = (): void => { listener(); };
      comments.observeDeep(observer);
      return () => comments.unobserveDeep(observer);
    },
  };
}
