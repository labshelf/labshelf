/** Pins the Space list the share workflows see on the desktop, the Space sync's attach and detach with the share, and the page's share view. */
import * as vscode from 'vscode';
import type { ShareConnection, SpaceStore } from '@labshelf/core';
import { ActiveShares } from '../../../src/collab/node/session';
import { attachSpaceShareOf, createSharedSpaceCatalog, createSpaceSharingHost, type SpaceShareHostDeps } from '../../../src/collab/node/spaceShares';

const stopSync = jest.fn();
const attach = jest.fn((_share: unknown, _deps: unknown) => stopSync);
jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  attachSpaceShare: (share: unknown, deps: unknown) => attach(share, deps),
}));

function storeOf(rows: unknown[]): SpaceStore {
  return { list: () => rows, reload: jest.fn(async () => rows) } as unknown as SpaceStore;
}

const ready = (id: string, name: string, shared?: string) => ({ state: 'ready', space: { id, name, ...(shared ? { shared } : {}) } });

function connection(kind: 'project' | 'space', shareId = 's1'): ShareConnection {
  return {
    kind, shareId, folder: `/lib/spaces/${shareId}`,
    onStateChange: () => () => undefined, session: { onPeer: () => () => undefined }, close: jest.fn(async () => undefined),
  } as unknown as ShareConnection;
}

describe('createSharedSpaceCatalog', () => {
  it('lists the readable Spaces with their absolute folder and share id, and reloads the store', async () => {
    const store = storeOf([ready('a', 'Alpha', 'share-a'), ready('b', 'Beta'), { state: 'unreadable', id: 'c', reason: 'bad' }]);
    const catalog = createSharedSpaceCatalog({ current: () => ({ store, spaceDir: (id: string) => `/lib/spaces/${id}` }) as never });
    expect(catalog.list()).toEqual([
      { id: 'a', name: 'Alpha', folder: '/lib/spaces/a', shared: 'share-a' },
      { id: 'b', name: 'Beta', folder: '/lib/spaces/b' },
    ]);
    await catalog.reload();
    expect(store.reload).toHaveBeenCalled();
  });

  it('lists nothing with no library open', async () => {
    const catalog = createSharedSpaceCatalog({ current: () => undefined });
    expect(catalog.list()).toEqual([]);
    await expect(catalog.reload()).resolves.toBeUndefined();
  });
});

describe('attachSpaceShareOf', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the Space sync only for a Space share and stops it when the share is removed', async () => {
    const deps = { ports: {} } as never;
    const shares = new ActiveShares((share) => attachSpaceShareOf(share, () => deps));
    shares.add(connection('project', 'p1'));
    expect(attach).not.toHaveBeenCalled();
    const space = connection('space', 's1');
    shares.add(space);
    expect(attach).toHaveBeenCalledWith(space, deps);
    await shares.remove('s1');
    expect(stopSync).toHaveBeenCalledTimes(1);
    shares.dispose();
  });

  it('attaches nothing with no library open', () => {
    expect(attachSpaceShareOf(connection('space'), () => undefined)).toBeInstanceOf(vscode.Disposable);
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('createSpaceSharingHost spaceShareState', () => {
  function host(rows: unknown[], active: ShareConnection | undefined): ReturnType<typeof createSpaceSharingHost> {
    const store = storeOf(rows);
    const spaces = { current: () => ({ store, spaceDir: (id: string) => `/lib/spaces/${id}` }), onDidChangeSpaces: jest.fn(), provideSharing: jest.fn() };
    const ports = { spaces: createSharedSpaceCatalog(spaces as never), shares: { active: () => active }, logger: {} };
    const services = { library: { snapshot: { papers: new Map() }, onChange: () => () => undefined }, mutations: {} };
    return createSpaceSharingHost({
      ports: () => ports, spaces, services: () => services, projects: { onDidChange: jest.fn() }, shares: { onDidChange: jest.fn() },
    } as unknown as SpaceShareHostDeps);
  }

  it('reports an unshared Space as not shared', () => {
    expect(host([ready('a', 'Alpha')], undefined).spaceShareState('a')).toEqual({ shared: false, connected: false });
  });

  it('lists the peers of the Space from the presence of its share connection, and the author it was given', () => {
    const presence = { remote: () => [{ name: 'Ada', colour: '#f00', conversation: { path: 'discussions/a.qmd', typing: true } }], setConversation: jest.fn(), awareness: { on: jest.fn(), off: jest.fn() } };
    const store = storeOf([ready('a', 'Alpha', 'share-a')]);
    const spaces = { current: () => ({ store, spaceDir: (id: string) => `/lib/spaces/${id}` }), onDidChangeSpaces: jest.fn(), provideSharing: jest.fn() };
    const sharing = createSpaceSharingHost({
      ports: () => ({}), spaces, services: () => undefined, projects: { onDidChange: jest.fn() },
      shares: { onDidChange: jest.fn(() => ({ dispose: jest.fn() })), active: (id: string) => (id === 'share-a' ? { presence } : undefined) }, author: () => 'Bea',
    } as unknown as SpaceShareHostDeps);
    expect(sharing.spacePeers('a')).toEqual([{ name: 'Ada', colour: '#f00', path: 'discussions/a.qmd', typing: true }]);
    expect(sharing.author()).toBe('Bea');
  });

  it('reports a shared Space without a connection as shared and offline', () => {
    expect(host([ready('a', 'Alpha', 'share-a')], undefined).spaceShareState('a')).toEqual({ shared: true, connected: false });
  });
});
