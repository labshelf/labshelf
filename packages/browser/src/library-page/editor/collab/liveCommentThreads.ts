// Serves the page's comment UI from a shared project's threads, through the core lifecycle over its session.
// CONTRACT: documents/contracts/collaboration.md#comments
import { sharedProjectComments, type Comment, type CommentThread, type ILogger, type ShareSession, type TextRange } from "@labshelf/core";
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
  const comments = sharedProjectComments(session);
  const checkProject = (id: string): void => {
    if (id !== projectId) { throw new Error(`Project ${id} is not the shared project ${projectId}, so its comments cannot be used`); }
  };
  const located = (thread: CommentThread): ReviewThread => {
    const range = comments.locate(thread);
    const text = comments.textOf(thread.file);
    return { ...thread, line: range === "detached" || text === undefined ? undefined : lineAt(text, range.start) };
  };
  const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: author(), body, createdAt: new Date().toISOString() });
  const edit = async (action: string, threadId: string, change: () => void): Promise<void> => {
    try {
      change();
    } catch (error) {
      await logger.error(MODULE, error, { action, projectId, threadId });
      throw error;
    }
  };
  const rangesOf = (path: string): TextRange[] => comments.threads().filter((each) => each.file === path && !each.resolved)
    .map((each) => comments.locate(each)).filter((each): each is TextRange => each !== "detached");

  return {
    async threads(id, path) {
      checkProject(id);
      return comments.threads().filter((each) => path === undefined || each.file === path).map(located);
    },
    commentAnchorsFor: (id, path) => ({
      subscribe(listener) {
        checkProject(id);
        listener(rangesOf(path));
        return comments.onChange(() => listener(rangesOf(path)));
      },
    }),
    async addComment(id, path, range, body) {
      checkProject(id);
      const threadId = globalThis.crypto.randomUUID();
      await edit("add a comment", threadId, () => comments.add({ id: threadId, file: path, anchor: comments.anchor(path, range), comments: [newComment(body)], resolved: false }));
      await logger.log("INFO", MODULE, "Added a comment to a shared file", { projectId, path, threadId });
    },
    reply: (threadId, body) => edit("reply to a comment", threadId, () => comments.reply(threadId, newComment(body))),
    resolve: (threadId) => edit("resolve a comment", threadId, () => comments.setResolved(threadId, true)),
    onDidChange: (listener) => comments.onChange(listener),
  };
}
