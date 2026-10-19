// Keeps a shared project's comment threads in its index doc, anchored to the live file docs, for the page's comment UI.
// CONTRACT: documents/contracts/collaboration.md#comments
import {
  addLiveThread, indexComments, liveAnchorFor, liveThreads, locateThread, replyToLiveThread, setLiveThreadResolved,
  type Comment, type CommentThread, type ILogger, type ShareSession, type TextRange,
} from "@labshelf/core";
import type { CommentThreads, ReviewThread } from "../../review";

const MODULE = "library-page.editor.collab";

export interface LiveCommentThreadsOptions {
  session: Pick<ShareSession, "index" | "openDoc">;
  /** The id of the project the share holds. */
  projectId: string;
  /** This user's name on the comments they write. */
  author: () => string;
  logger: ILogger;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

export function createLiveCommentThreads({ session, projectId, author, logger }: LiveCommentThreadsOptions): CommentThreads {
  const textOf = (path: string) => session.openDoc(path).getText("content");
  const checkProject = (id: string): void => {
    if (id !== projectId) { throw new Error(`Project ${id} is not the shared project ${projectId}, so its comments cannot be used`); }
  };
  const located = (thread: CommentThread): ReviewThread => {
    const yText = textOf(thread.file);
    const text = yText.toString();
    const range = locateThread(thread, text, yText);
    return { ...thread, line: range === "detached" ? undefined : lineAt(text, range.start) };
  };
  const onDidChange = (listener: () => void): (() => void) => {
    const comments = indexComments(session.index);
    const observer = (): void => { listener(); };
    comments.observeDeep(observer);
    return () => comments.unobserveDeep(observer);
  };
  const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: author(), body, createdAt: new Date().toISOString() });
  const changed = async (done: boolean, action: string, threadId: string): Promise<void> => {
    if (done) { return; }
    const error = new Error(`Comment thread ${threadId} is not in the shared project, so it cannot be changed`);
    await logger.error(MODULE, error, { action, projectId, threadId });
    throw error;
  };
  const rangesOf = (path: string): TextRange[] => {
    const yText = textOf(path);
    const text = yText.toString();
    return liveThreads(session.index).filter((each) => each.file === path && !each.resolved)
      .map((each) => locateThread(each, text, yText)).filter((each): each is TextRange => each !== "detached");
  };

  return {
    async threads(id, path) {
      checkProject(id);
      return liveThreads(session.index).filter((each) => path === undefined || each.file === path).map(located);
    },
    commentAnchorsFor: (id, path) => ({
      subscribe(listener) {
        checkProject(id);
        listener(rangesOf(path));
        return onDidChange(() => listener(rangesOf(path)));
      },
    }),
    async addComment(id, path, range, body) {
      checkProject(id);
      const thread: CommentThread = {
        id: globalThis.crypto.randomUUID(), file: path, anchor: liveAnchorFor(textOf(path), range.start, range.end), comments: [newComment(body)], resolved: false,
      };
      await changed(addLiveThread(session.index, thread), "add a comment", thread.id);
      await logger.log("INFO", MODULE, "Added a comment to a shared file", { projectId, path, threadId: thread.id });
    },
    reply: (threadId, body) => changed(replyToLiveThread(session.index, threadId, newComment(body)), "reply to a comment", threadId),
    resolve: (threadId) => changed(setLiveThreadResolved(session.index, threadId, true), "resolve a comment", threadId),
    onDidChange,
  };
}
