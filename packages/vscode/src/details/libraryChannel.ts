// Feeds the library UI over the Details view's `library` channel and answers its messages through the list handlers.
import type { DetailsToHost, HostToUi } from "@labshelf/core";
import { feedHostContext, handleListMessage, LibraryFeed, type ListPanelDeps } from "../ui/list/index.js";
import type { ListHostContext } from "../ui/list/host/index.js";

export interface LibraryChannel {
  /** True once the page's `ready` has been answered. */
  readonly ready: boolean;
  handle(message: Extract<DetailsToHost, { channel: "library" }>["msg"]): Promise<void>;
  dispose(): void;
}

export interface LibraryChannelOptions {
  post: (message: { channel: "library"; msg: HostToUi }) => Thenable<unknown>;
  /** Runs after the library has been pushed in answer to `ready`. */
  onReady: () => Promise<void>;
  /** The page asked to open a folder (UI path); the owner routes it to the paper list. */
  onFolderOpen: (folder: string) => void;
}

export function startLibraryChannel(deps: ListPanelDeps, { post, onReady, onFolderOpen }: LibraryChannelOptions): LibraryChannel {
  const feed = new LibraryFeed(deps, (msg) => post({ channel: "library", msg }));
  // The page follows the selection it is shown; it neither navigates nor selects on its own.
  const ctx: ListHostContext = feedHostContext(deps, feed, {
    onReady: async () => {
      feed.queue.markReady();
      await feed.push();
      await feed.queue.flush();
      await onReady();
    },
    onNavigate: () => {},
    onSelect: () => {},
  });
  return {
    get ready() { return feed.queue.ready; },
    handle: async (message) => {
      if (message.type === "folder.open") { onFolderOpen(message.folder); return; }
      await handleListMessage(ctx, message);
    },
    dispose: () => feed.dispose(),
  };
}
