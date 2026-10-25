// Runs the comment lifecycle of a shared project over its session, placing each thread in the live text of its file.
// CONTRACT: documents/contracts/collaboration.md#comments
import type * as Y from "yjs";
import { fileText, indexComments, indexFiles } from "../model/index.js";
import type { ShareSession } from "../doc/index.js";
import { liveAnchorFor, type TextRange } from "./commentAnchor.js";
import type { Comment, CommentAnchor, CommentThread } from "./commentThread.js";
import { locateThread } from "./findThread.js";
import { addLiveThread, liveThreads, replyToLiveThread, setLiveThreadResolved } from "./liveComments.js";

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

export function sharedProjectComments(session: Pick<ShareSession, "index" | "openDoc">): SharedProjectComments {
  const { index } = session;
  // INVARIANT: only a listed text file is opened, so a thread naming another path never creates a doc for it.
  const liveText = (file: string): Y.Text | undefined => (indexFiles(index).get(file)?.kind === "text" ? fileText(session.openDoc(file)) : undefined);
  const requireText = (file: string): Y.Text => {
    const yText = liveText(file);
    if (!yText) { throw new Error(`The share holds no text file ${file}, so a comment cannot be anchored in it`); }
    return yText;
  };
  const missing = (threadId: string): Error => new Error(`The share holds no comment thread ${threadId}`);
  return {
    threads: () => liveThreads(index),
    textOf: (file) => liveText(file)?.toString(),
    locate(thread) {
      const yText = liveText(thread.file);
      return yText ? locateThread(thread, yText.toString(), yText) : "detached";
    },
    anchor: (file, range) => liveAnchorFor(requireText(file), range.start, range.end),
    add(thread) {
      if (!addLiveThread(index, thread)) { throw new Error(`The share already holds a comment thread with id ${thread.id}`); }
    },
    reply(threadId, comment) {
      if (!replyToLiveThread(index, threadId, comment)) { throw missing(threadId); }
    },
    setResolved(threadId, resolved) {
      if (!setLiveThreadResolved(index, threadId, resolved)) { throw missing(threadId); }
    },
    onChange(listener) {
      const comments = indexComments(index);
      const observer = (): void => { listener(); };
      comments.observeDeep(observer);
      return () => comments.unobserveDeep(observer);
    },
  };
}
