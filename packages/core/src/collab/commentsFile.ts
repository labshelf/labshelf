// Edits a project's comment threads, loads and writes .labshelf/comments.qmd through an injected file access, syncs it with a share's comments map and runs the comment lifecycle of a shared project.
// CONTRACT: documents/contracts/qmd-items.md#comments
// CONTRACT: documents/contracts/library-format.md#project-folder-labshelf
// CONTRACT: documents/contracts/collaboration.md#comments
import type * as Y from "yjs";
import { deriveLiveAnchor, findThread, readThread, compareThreads, addLiveThread, readLiveThreads, addLiveThreadReply, setLiveThreadResolved, type Comment, type CommentAnchor, type CommentThread, type TextRange } from "./comments.js";
import { parseCommentsQmd, serializeCommentsQmd } from "./commentsQmd.js";
import type { ShareSession } from "./docSync.js";
import { readShareIndexDocComments, readShareIndexDocFiles } from "./shareIndexDoc.js";
import { readFileText } from "./sharedFiles.js";

export const COMMENTS_PATH = ".labshelf/comments.qmd";

/** The threads of the file; the other keys carry what a rewrite must keep (unknown attributes, other items, loose text) and are opaque to callers. */
export interface CommentsDocument {
  [key: string]: unknown;
  threads: readonly CommentThread[];
}

/** @returns the valid threads in file order, each with its valid comments */
export function deriveCommentThreads(doc: CommentsDocument): CommentThread[] {
  return doc.threads.map(readThread).filter((each): each is CommentThread => each !== undefined);
}

export function addThread(doc: CommentsDocument, thread: CommentThread): CommentsDocument {
  return { ...doc, threads: [...doc.threads, thread] };
}

function editThread(doc: CommentsDocument, id: string, edit: (thread: CommentThread) => CommentThread): CommentsDocument {
  return { ...doc, threads: doc.threads.map((each) => (each.id === id ? edit(each) : each)) };
}

export function addThreadReply(doc: CommentsDocument, threadId: string, comment: Comment): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, comments: [...thread.comments, comment] }));
}

/** Resolves the thread, or reopens it when `resolved` is false. */
export function setThreadResolved(doc: CommentsDocument, threadId: string, resolved: boolean): CommentsDocument {
  return editThread(doc, threadId, (thread) => ({ ...thread, resolved }));
}

/** Reads and writes the text of one comments.qmd; the adapter creates missing folders on write. */
export interface CommentsFileAccess {
  /** The file's text, or undefined when there is none. */
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** @returns the document (empty when the file is missing), or undefined when the file holds conflict markers; a read error rejects */
export async function loadCommentsDocument(access: CommentsFileAccess): Promise<CommentsDocument | undefined> {
  const text = await access.read();
  return text === undefined ? { threads: [] } : parseCommentsQmd(text);
}

/** Applies `change` to a fresh read, so an edit made elsewhere since the last load is kept; an unreadable file is never overwritten. */
export async function updateCommentsDocument(access: CommentsFileAccess, change: (doc: CommentsDocument) => CommentsDocument): Promise<void> {
  const doc = await loadCommentsDocument(access);
  if (!doc) { throw new Error(`${COMMENTS_PATH} holds conflict markers, so it is left as it is`); }
  await access.write(serializeCommentsQmd(change(doc)));
}

/**
 * The map's threads in member order, with the other items, unknown attributes and loose text of `existing`.
 * @param existing the current file's text, undefined when there is none
 * @returns undefined when `existing` is unreadable, which is never overwritten
 */
export function renderCommentsFile(doc: Y.Doc, existing: string | undefined): string | undefined {
  const current: CommentsDocument | undefined = existing === undefined ? { threads: [] } : parseCommentsQmd(existing);
  if (!current) { return undefined; }
  return serializeCommentsQmd({ ...current, threads: [...readLiveThreads(doc)].sort(compareThreads) });
}

/**
 * Adds the file's valid threads that the map does not hold.
 * @returns how many were added, or undefined when the text is unreadable
 */
export function importCommentsFile(doc: Y.Doc, text: string): number | undefined {
  const file = parseCommentsQmd(text);
  if (!file) { return undefined; }
  let added = 0;
  doc.transact(() => {
    for (const thread of file.threads) {
      if (addLiveThread(doc, thread)) { added += 1; }
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
