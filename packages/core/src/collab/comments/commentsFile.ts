// Parses, edits and serializes a project's .labshelf/comments.json, keeping what it does not understand.
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
import { parseJsonObject } from "../../writing/project/index.js";
import { isJsonObject, readThread, type Comment, type CommentThread } from "./commentThread.js";

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
  if (!isJsonObject(value)) { return value; }
  const known = keys.filter((key) => key in value).map((key) => [key, value[key]]);
  return Object.fromEntries([...known, ...Object.entries(value).filter(([key]) => !keys.includes(key))]);
}

function orderedThread(value: unknown): unknown {
  const thread = ordered(value, THREAD_KEYS);
  if (!isJsonObject(thread)) { return thread; }
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
  return { ...doc, threads: doc.threads.map((each) => (isJsonObject(each) && each["id"] === id && readThread(each) ? edit(each) : each)) };
}

export function addThreadReply(doc: CommentsDocument, threadId: string, comment: Comment): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, comments: [...(thread["comments"] as unknown[]), comment] }));
}

/** Resolves the thread, or reopens it when `resolved` is false. */
export function setThreadResolved(doc: CommentsDocument, threadId: string, resolved: boolean): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, resolved }));
}
