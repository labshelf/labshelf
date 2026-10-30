// Shows and stores a project's comment threads: the store over comments.qmd and its routing to a share's live threads; the editor's marks and Add comment action come from core with the browser's footer.
// CONTRACT: documents/contracts/collaboration.md#comments
import {
  addThread, lineAt, deriveAnchor, COMMENTS_PATH, deriveCommentThreads, updateCommentsDocument, loadCommentsDocument, findThread, posixPathOps, addThreadReply, setThreadResolved,
  type Comment, type CommentsFileAccess, type CommentThread, type ILogger, type LibraryFileSystem, type TextRange,
} from "@labshelf/core";
import {
  createCommentSupport as createCoreCommentSupport, mountBodyInput as mountCoreBodyInput, mountQmdEditor, type BodyInput, type CommentSupport, type CommentSupportDeps,
} from "@labshelf/core/dom";
import { createSourceFooter } from "../libraryUi";
import type { ProjectSession } from "../writing";
import type { PageShares } from "./pageShares";

export { addCommentSupport, type BodyInput, type CommentSupport, type CommentSupportDeps, type EditorComments } from "@labshelf/core/dom";

const THREADS_MODULE = "collab.comments";
const AUTHOR = "You";

/** A thread with its place in the file's saved text. */
export interface LocatedThread extends CommentThread {
  /** One-based line of the commented text; undefined when the text is gone from the file. */
  line: number | undefined;
}

export interface CommentThreads {
  /** The project's threads in file order of the store, optionally of one file. Throws when comments.qmd is not valid. */
  threads(projectId: string, path?: string): Promise<LocatedThread[]>;
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

type Session = Pick<ProjectSession, "current">;

function openFolder(session: Session, projectId?: string): string {
  const entry = session.current();
  if (entry?.kind !== "ready" || (projectId !== undefined && entry.settings.id !== projectId)) {
    throw new Error(`Project ${projectId ?? "(none)"} is not the open project, so its comments cannot be used`);
  }
  return entry.folder;
}

function accessOf(fs: LibraryFileSystem, folder: string): CommentsFileAccess {
  const file = posixPathOps.join(folder, COMMENTS_PATH);
  return {
    read: async () => (await fs.exists(file) ? fs.readText(file) : undefined),
    write: async (text) => { await fs.ensureDir(posixPathOps.dirname(file)); await fs.writeText(file, text); },
  };
}

async function readFileText(fs: LibraryFileSystem, folder: string, path: string): Promise<string | undefined> {
  const file = posixPathOps.join(folder, path);
  return await fs.exists(file) ? fs.readText(file) : undefined;
}

async function stored(fs: LibraryFileSystem, folder: string): Promise<CommentThread[]> {
  const doc = await loadCommentsDocument(accessOf(fs, folder));
  if (!doc) { throw new Error(`${COMMENTS_PATH} is not a valid comments file. Fix the file to see and add comments.`); }
  return deriveCommentThreads(doc);
}

async function locateThreads(fs: LibraryFileSystem, folder: string, path: string | undefined): Promise<LocatedThread[]> {
  const inFile = (await stored(fs, folder)).filter((each) => path === undefined || each.file === path);
  const texts = new Map<string, string | undefined>();
  for (const file of new Set(inFile.map((each) => each.file))) { texts.set(file, await readFileText(fs, folder, file)); }
  return inFile.map((each) => {
    const text = texts.get(each.file);
    const range = text === undefined ? "detached" : findThread(each, text);
    return { ...each, line: range === "detached" ? undefined : lineAt(text!, range.start) };
  });
}

async function openRanges(fs: LibraryFileSystem, folder: string, path: string): Promise<TextRange[]> {
  const text = await readFileText(fs, folder, path);
  if (text === undefined) { return []; }
  const located = (await stored(fs, folder)).filter((each) => each.file === path && !each.resolved).map((each) => findThread(each, text));
  return located.filter((each): each is TextRange => each !== "detached");
}

const newComment = (body: string): Comment => ({ id: globalThis.crypto.randomUUID(), author: AUTHOR, body, createdAt: new Date().toISOString() });

export function createCommentThreads({ fs, session, logger }: CommentThreadsOptions): CommentThreads {
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) { listener(); } };
  const onDidChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => void listeners.delete(listener); };

  const edit = async (folder: string, change: Parameters<typeof updateCommentsDocument>[1], action: string): Promise<void> => {
    try {
      await updateCommentsDocument(accessOf(fs, folder), change);
    } catch (error) {
      await logger.error(THREADS_MODULE, error, { action, folder });
      throw error;
    }
    notify();
  };
  const rangesOf = async (projectId: string, path: string): Promise<TextRange[]> => openRanges(fs, openFolder(session, projectId), path);

  return {
    threads: async (projectId, path) => locateThreads(fs, openFolder(session, projectId), path),
    onDidChange,
    commentAnchorsFor: (projectId, path) => ({
      subscribe(listener) {
        const push = (): void => {
          rangesOf(projectId, path).then(listener, (error: unknown) => {
            void logger.error(THREADS_MODULE, error, { action: "read comment anchors", projectId, path });
            listener([]);
          });
        };
        push();
        return onDidChange(push);
      },
    }),
    async addComment(projectId, path, range, text) {
      const folder = openFolder(session, projectId);
      const source = await readFileText(fs, folder, path);
      if (source === undefined) { throw new Error(`${path} does not exist in the project, so it cannot be commented`); }
      const thread: CommentThread = { id: globalThis.crypto.randomUUID(), file: path, anchor: deriveAnchor(source, range.start, range.end), comments: [newComment(text)], resolved: false };
      await edit(folder, (doc) => addThread(doc, thread), "add a comment");
    },
    reply: (threadId, text) => edit(openFolder(session), (doc) => addThreadReply(doc, threadId, newComment(text)), "reply to a comment"),
    resolve: (threadId) => edit(openFolder(session), (doc) => setThreadResolved(doc, threadId, true), "resolve a comment"),
  };
}


export interface RoutedCommentThreadsOptions {
  /** The store over comments.qmd. */
  files: CommentThreads;
  shares: Pick<PageShares, "live" | "onChange">;
  session: Pick<ProjectSession, "current">;
}

export function createRoutedCommentThreads({ files, shares, session }: RoutedCommentThreadsOptions): CommentThreads {
  const storeFor = (projectId: string | undefined): CommentThreads => (projectId === undefined ? undefined : shares.live(projectId)?.comments) ?? files;
  const openProject = (): string | undefined => {
    const entry = session.current();
    return entry?.kind === "ready" ? entry.settings.id : undefined;
  };
  return {
    threads: (projectId, path) => storeFor(projectId).threads(projectId, path),
    addComment: (projectId, path, range, text) => storeFor(projectId).addComment(projectId, path, range, text),
    reply: (threadId, text) => storeFor(openProject()).reply(threadId, text),
    resolve: (threadId) => storeFor(openProject()).resolve(threadId),
    commentAnchorsFor: (projectId, path) => ({
      subscribe(listener) {
        let stop = storeFor(projectId).commentAnchorsFor(projectId, path).subscribe(listener);
        const stopShares = shares.onChange(() => { stop(); stop = storeFor(projectId).commentAnchorsFor(projectId, path).subscribe(listener); });
        return () => { stopShares(); stop(); };
      },
    }),
    onDidChange(listener) {
      const live = (): CommentThreads | undefined => { const id = openProject(); return id === undefined ? undefined : shares.live(id)?.comments; };
      let stopLive = live()?.onDidChange(listener);
      const stopFiles = files.onDidChange(listener);
      const stopShares = shares.onChange(() => { stopLive?.(); stopLive = live()?.onDidChange(listener); listener(); });
      return () => { stopShares(); stopFiles(); stopLive?.(); };
    },
  };
}

/** The editor's comment marks and Add comment action, with the library's footer around the button and this page's qmd editor for the body. */
export function createCommentSupport(deps: CommentSupportDeps): CommentSupport {
  return createCoreCommentSupport({ renderFooter: createSourceFooter, mountEditor: mountQmdEditor, ...deps });
}

/** Mounts an editable editor for a comment body in `host`; Mod-Enter calls `onSubmit` and Escape calls `onCancel`. */
export function mountBodyInput(host: HTMLElement, handlers: { onSubmit(): void; onCancel?(): void }): BodyInput {
  return mountCoreBodyInput(host, handlers, mountQmdEditor);
}
