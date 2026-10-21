// Sends comment calls to a shared project's live threads while its share is connected, and to the comments.json store otherwise.
import type { PageShares } from "../editor/collab";
import type { ProjectSession } from "../session";
import type { CommentThreads } from "./commentThreads";

export interface RoutedCommentThreadsOptions {
  /** The store over comments.json. */
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
