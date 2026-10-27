// Mounts the core Spaces catalog over the browser host port.
import { mountSpacesCatalog } from '@labshelf/core/dom';
import { mountSpacesTab } from './mountSpacesTab';
import type { TabModule } from './tabKinds';

export const mountTab: TabModule['mountTab'] = (host, _params, ctx) => mountSpacesTab(host, ctx, mountSpacesCatalog);
