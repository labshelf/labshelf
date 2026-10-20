// Writes a shared project's comments.json from its comments map, and seeds the map from a comments.json.
// CONTRACT: documents/contracts/collaboration.md#comments
import type { Doc } from "yjs";
import { compareThreads, readThread, type CommentThread } from "./commentThread.js";
import { parseCommentsFile, serializeCommentsFile, type CommentsDocument } from "./commentsFile.js";
import { addLiveThread, rawLiveThreads } from "./live/index.js";

/**
 * The map's threads in member order, then the entries of `existing` that are not valid threads, under its other keys.
 * @param existing the current file's text, undefined when there is none
 * @returns undefined when `existing` is not a valid comments.json, which is never overwritten
 */
export function renderCommentsFile(doc: Doc, existing: string | undefined): string | undefined {
  const current: CommentsDocument | undefined = existing === undefined ? { threads: [] } : parseCommentsFile(existing);
  if (!current) { return undefined; }
  const threads = rawLiveThreads(doc)
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
export function importCommentsFile(doc: Doc, text: string): number | undefined {
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
