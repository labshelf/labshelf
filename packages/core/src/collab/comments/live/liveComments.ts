// Reads and edits the comment threads of a shared project in its index doc's comments map.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as Y from "yjs";
import { indexComments } from "../../model/index.js";
import { compareThreads, readThread, type Comment, type CommentThread } from "../commentThread.js";

// INVARIANT: every key of a thread is a plain value except `comments`, a Y.Array, so concurrent replies merge.
function threadMap(thread: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(thread)) {
    map.set(key, key === "comments" && Array.isArray(value) ? Y.Array.from(value) : value);
  }
  return map;
}

/** Each thread as the plain JSON a client wrote, unknown keys included; entries that are not a thread map are skipped. */
export function rawLiveThreads(doc: Y.Doc): Record<string, unknown>[] {
  const threads: Record<string, unknown>[] = [];
  indexComments(doc).forEach((value) => { if (value instanceof Y.Map) { threads.push(value.toJSON()); } });
  return threads;
}

/** The valid threads in the order every member sees. */
export function liveThreads(doc: Y.Doc): CommentThread[] {
  return rawLiveThreads(doc).map(readThread).filter((each): each is CommentThread => each !== undefined).sort(compareThreads);
}

/** Adds the thread unless the map holds one with its id; unknown keys of `thread` travel with it. */
export function addLiveThread(doc: Y.Doc, thread: CommentThread | Record<string, unknown>): boolean {
  const comments = indexComments(doc);
  const id = thread["id"];
  if (typeof id !== "string" || comments.has(id)) { return false; }
  comments.set(id, threadMap(thread as Record<string, unknown>));
  return true;
}

function liveThread(doc: Y.Doc, threadId: string): Y.Map<unknown> | undefined {
  const value = indexComments(doc).get(threadId);
  return value instanceof Y.Map ? value : undefined;
}

/** @returns false when the map holds no such thread */
export function replyToLiveThread(doc: Y.Doc, threadId: string, comment: Comment): boolean {
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
