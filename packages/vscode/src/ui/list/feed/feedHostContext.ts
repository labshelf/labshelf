// Builds the host context the list message handlers run on, over a library feed and the owner's reactions.
import type { PaperRecord } from '@labshelf/core';
import type { ListHostContext } from '../host/index.js';
import type { ListPanelDeps } from '../listPanelDeps.js';
import type { LibraryFeed } from './libraryFeed.js';

export type FeedReactions = Pick<ListHostContext, 'onReady' | 'onNavigate' | 'onSelect'>;

export function feedHostContext(deps: ListPanelDeps, feed: LibraryFeed, reactions: FeedReactions): ListHostContext {
  return {
    deps,
    paths: () => feed.paths(),
    post: (m) => feed.queue.post(m),
    notice: (kind, text) => { void feed.queue.post({ type: 'notice', kind, text }); },
    papers: async (ids) => {
      const byId = new Map((await deps.paperService.listPapers()).map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
    },
    ...reactions,
  };
}
