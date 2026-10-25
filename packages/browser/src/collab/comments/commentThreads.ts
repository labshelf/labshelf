// Stores a project's comment threads in its .labshelf/comments.json over the page's library folder and places them in the project's files.
// CONTRACT: documents/contracts/collaboration.md#comments
import {
  addThread, deriveAnchor, COMMENTS_PATH, deriveCommentThreads, updateCommentsDocument, loadCommentsDocument, findThread, posixPathOps, addThreadReply, setThreadResolved,
  type Comment, type CommentsFileAccess, type CommentThread, type ILogger, type LibraryFileSystem, type TextRange,
} from "@labshelf/core";
import type { ProjectSession } from "../../writing/session";

const MODULE = "collab.comments";
const AUTHOR = "You";

/** A thread with its place in the file's saved text. */
export interface ReviewThread extends CommentThread {
  /** One-based line of the commented text; undefined when the text is gone from the file. */
  line: number | undefined;
}

export interface CommentThreads {
  /** The project's threads in file order of the store, optionally of one file. Throws when comments.json is not valid. */
  threads(projectId: string, path?: string): Promise<ReviewThread[]>;
  /** Calls the listener now and after each change with the ranges of the file's open threads. */
  commentAnchorsFor(projectId: string, path: string): { subscribe(listener: (ranges: TextRange[]) => void): () => void };
  addComment(projectId: string, path: string, range: TextRange, text: string): Promise<void>;
  /** Replies in the open project. */
  reply(threadId: string, text: string): Promise<void>;
  /** Resolves a thread of the open project. */
  resolve(threadId: string): Promise<void>;
  /** Calls the listener after a thread was added, replied to or resolved here. */
  onDidChange(listener: () => void): () => void;
}

export interface CommentThreadsOptions {
  fs: LibraryFileSystem;
  session: Pick<ProjectSession, "current">;
  logger: ILogger;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

export function createCommentThreads({ fs, session, logger }: CommentThreadsOptions): CommentThreads {
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) { listener(); } };
  const onDidChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => void listeners.delete(listener); };

  const openFolder = (projectId?: string): string => {
    const entry = session.current();
    if (entry?.kind !== "ready" || (projectId !== undefined && entry.settings.id !== projectId)) {
      throw new Error(`Project ${projectId ?? "(none)"} is not the open project, so its comments cannot be used`);
    }
    return entry.folder;
  };
  const accessOf = (folder: string): CommentsFileAccess => {
    const file = posixPathOps.join(folder, COMMENTS_PATH);
    return {
      read: async () => (await fs.exists(file) ? fs.readText(file) : undefined),
      write: async (text) => { await fs.ensureDir(posixPathOps.dirname(file)); await fs.writeText(file, text); },
    };
  };
  const readFileText = async (folder: string, path: string): Promise<string | undefined> => {
    const file = posixPathOps.join(folder, path);
    return await fs.exists(file) ? fs.readText(file) : undefined;
  };
  const edit = async (folder: string, change: Parameters<typeof updateCommentsDocument>[1], action: string): Promise<void> => {
    try {
      await updateCommentsDocument(accessOf(folder), change);
    } catch (error) {
      await logger.error(MODULE, error, { action, folder });
      throw error;
    }
    notify();
  };

  const stored = async (folder: string): Promise<CommentThread[]> => {
    const doc = await loadCommentsDocument(accessOf(folder));
    if (!doc) { throw new Error(`${COMMENTS_PATH} is not valid JSON with a threads list. Fix the file to see and add comments.`); }
    return deriveCommentThreads(doc);
  };

  const threads: CommentThreads["threads"] = async (projectId, path) => {
    const folder = openFolder(projectId);
    const inFile = (await stored(folder)).filter((each) => path === undefined || each.file === path);
    const texts = new Map<string, string | undefined>();
    for (const file of new Set(inFile.map((each) => each.file))) { texts.set(file, await readFileText(folder, file)); }
    return inFile.map((each) => {
      const text = texts.get(each.file);
      const range = text === undefined ? "detached" : findThread(each, text);
      return { ...each, line: range === "detached" ? undefined : lineAt(text!, range.start) };
    });
  };

  const rangesOf = async (projectId: string, path: string): Promise<TextRange[]> => {
    const folder = openFolder(projectId);
    const text = await readFileText(folder, path);
    if (text === undefined) { return []; }
    const located = (await stored(folder)).filter((each) => each.file === path && !each.resolved).map((each) => findThread(each, text));
    return located.filter((each): each is TextRange => each !== "detached");
  };

  const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: AUTHOR, body, createdAt: new Date().toISOString() });

  return {
    threads,
    onDidChange,
    commentAnchorsFor: (projectId, path) => ({
      subscribe(listener) {
        const push = (): void => {
          rangesOf(projectId, path).then(listener, (error: unknown) => {
            void logger.error(MODULE, error, { action: "read comment anchors", projectId, path });
            listener([]);
          });
        };
        push();
        return onDidChange(push);
      },
    }),
    async addComment(projectId, path, range, text) {
      const folder = openFolder(projectId);
      const source = await readFileText(folder, path);
      if (source === undefined) { throw new Error(`${path} does not exist in the project, so it cannot be commented`); }
      const thread: CommentThread = { id: globalThis.crypto.randomUUID(), file: path, anchor: deriveAnchor(source, range.start, range.end), comments: [newComment(text)], resolved: false };
      await edit(folder, (doc) => addThread(doc, thread), "add a comment");
    },
    reply: (threadId, text) => edit(openFolder(), (doc) => addThreadReply(doc, threadId, newComment(text)), "reply to a comment"),
    resolve: (threadId) => edit(openFolder(), (doc) => setThreadResolved(doc, threadId, true), "resolve a comment"),
  };
}
