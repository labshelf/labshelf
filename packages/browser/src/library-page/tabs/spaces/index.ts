// Mounts the core Spaces catalog over the browser host port.
import { createLoopbackTransport, localDay, serveSpaces, type SpacesToHost, type HostToSpaces } from '@labshelf/core';
import { mountSpacesCatalog } from '@labshelf/core/dom';
import type { TabModule } from '..';

export const mountTab: TabModule['mountTab'] = (host, _params, ctx) => {
  const { ui, host: endpoint } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const stop = serveSpaces(endpoint, { ...ctx.spaces, logger: ctx.logger, today: () => localDay(Date.now()) });
  const dispose = mountSpacesCatalog(host, ui);
  return { dispose: () => { dispose(); stop(); } };
};
