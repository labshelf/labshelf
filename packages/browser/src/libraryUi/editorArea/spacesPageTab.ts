// Mounts a core Space page with inner navigation stored in the workspace hash.
import { createLoopbackTransport, localDay, serveSpaces, SPACE_TABS, type SpaceTab, type SpacesToHost, type HostToSpaces } from '@labshelf/core';
import { mountSpace } from '@labshelf/core/dom';
import { TAB_KINDS } from './tabKinds';
import type { TabModule } from './tabKind';

export const mountTab: TabModule['mountTab'] = (host, params, ctx) => {
  const { ui, host: endpoint } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const stop = serveSpaces(endpoint, { ...ctx.spaces, logger: ctx.logger, today: () => localDay(Date.now()) });
  const id = params['id']!;
  const tab = SPACE_TABS.includes(params['tab'] as SpaceTab) ? params['tab'] as SpaceTab : 'overview';
  const dispose = mountSpace(host, ui, { id, tab, onTab: next => {
    const currentId = TAB_KINDS.space.id(params);
    const group = ctx.workspace.tabs().find(t => t.id === currentId)?.group;
    void ctx.workspace.closeTabs(value => value === currentId).then(closed => {
      if (closed) ctx.workspace.openTab('space', { id, tab: next }, group);
    }).catch((error: unknown) => ctx.logger.error('spaces', error, { action: 'navigateSpace', id, tab: next }));
  } });
  return { dispose: () => { dispose(); stop(); } };
};
