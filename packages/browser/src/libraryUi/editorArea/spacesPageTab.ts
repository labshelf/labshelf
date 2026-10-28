// Mounts a core Space page with inner navigation stored in the workspace hash.
import { SPACE_TABS, type SpaceTab } from '@labshelf/core';
import { mountSpace } from '@labshelf/core/dom';
import { mountSpacesTab } from './mountSpacesTab';
import { TAB_KINDS, type TabModule } from './tabKinds';

export const mountTab: TabModule['mountTab'] = (host, params, ctx) => {
  const id = params['id']!;
  const tab = SPACE_TABS.includes(params['tab'] as SpaceTab) ? params['tab'] as SpaceTab : 'overview';
  return mountSpacesTab(host, ctx, (el, ui) => mountSpace(el, ui, { id, tab, onTab: next => {
    const currentId = TAB_KINDS.space.id(params);
    const group = ctx.workspace.tabs().find(t => t.id === currentId)?.group;
    void ctx.workspace.closeTabs(value => value === currentId).then(closed => {
      if (closed) ctx.workspace.openTab('space', { id, tab: next }, group);
    }).catch((error: unknown) => ctx.logger.error('spaces', error, { action: 'navigateSpace', id, tab: next }));
  } }));
};
