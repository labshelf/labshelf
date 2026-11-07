// Pins that the browser Spaces follow what the share mirrors write under spaces/, and that the author they stamp is the member's display name as it is now.
const stored: Record<string, unknown> = {};
const storageListeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const mirrorListeners = new Set<(paths: readonly string[]) => void>();

jest.mock('../../src/platform', () => ({
  ...jest.requireActual('../../src/platform'),
  watchVisibility: () => jest.fn(),
  bx: { storage: {
    local: {
      get: async (key: string) => (key in stored ? { [key]: JSON.parse(JSON.stringify(stored[key])) } : {}),
      set: async (items: Record<string, unknown>) => {
        Object.assign(stored, JSON.parse(JSON.stringify(items)));
        const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: JSON.parse(JSON.stringify(value)) }]));
        storageListeners.forEach((listener) => listener(changes, 'local'));
      },
    },
    onChanged: { addListener: (listener: never) => storageListeners.add(listener), removeListener: (listener: never) => storageListeners.delete(listener) },
  } },
}));
jest.mock('../../src/collab/mirror', () => ({
  ...jest.requireActual('../../src/collab/mirror'),
  onMirrorWrites: (listener: (paths: readonly string[]) => void) => { mirrorListeners.add(listener); return () => { mirrorListeners.delete(listener); }; },
}));

import { createLoopbackTransport, type ILogger, type ProjectLibraryPort, type SpaceStore, type SpacesHostPort } from '@labshelf/core';
import { createPageShares, DEFAULT_DISPLAY_NAME, writeMemberName } from '../../src/collab';
import { mountSpacesTab } from '../../src/libraryUi/editorArea/mountSpacesTab';
import { createPageSpaces, type PageSpaces } from '../../src/libraryUi/spaces';
import type { SpaceSharingPort } from '../../src/libraryUi/spaceSharing';
import { memoryLibraryFs } from '../support/memoryLibraryFs';

const logger: ILogger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function pageSpaces(): PageSpaces {
  const projects = { onDidChange: () => () => {}, list: async () => [] } as unknown as ProjectLibraryPort;
  const { ui } = createLoopbackTransport();
  return createPageSpaces({ fs: memoryLibraryFs(), logger, transport: ui, workspace: () => ({}) as never, selection: {} as never, projects: () => projects, openProject: jest.fn(async () => {}) });
}

beforeEach(() => { for (const key of Object.keys(stored)) delete stored[key]; });

describe('pageSpacesMirrorReload', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('reloads the Spaces once per 150 ms burst of mirror writes under spaces/', async () => {
    const spaces = pageSpaces();
    const reload = jest.spyOn(spaces.store, 'reload').mockResolvedValue([]);
    const emit = (paths: string[]): void => mirrorListeners.forEach((listener) => listener(paths));
    emit(['spaces/x/discussions/a.qmd']);
    emit(['spaces/x/notes/b.qmd']);
    emit(['spaces/x/space.json']);
    expect(reload).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(reload).toHaveBeenCalledTimes(1);
    emit(['spaces/x/discussions/a.qmd']);
    jest.advanceTimersByTime(150);
    expect(reload).toHaveBeenCalledTimes(2);
    spaces.dispose();
  });

  it('does not reload the Spaces for mirror writes under projects/, nor after dispose', () => {
    const spaces = pageSpaces();
    const reload = jest.spyOn(spaces.store, 'reload').mockResolvedValue([]);
    mirrorListeners.forEach((listener) => listener(['projects/thesis/main.tex']));
    jest.advanceTimersByTime(500);
    expect(reload).not.toHaveBeenCalled();
    spaces.dispose();
    expect(mirrorListeners.size).toBe(0);
  });
});

describe('pageSpacesAuthor', () => {
  it('uses the stored display name before sharing is bound, and the default before one is stored', async () => {
    const spaces = pageSpaces();
    await flush();
    expect(spaces.author()).toBe(DEFAULT_DISPLAY_NAME);
    await writeMemberName('Ada');
    expect(spaces.author()).toBe('Ada');
    spaces.dispose();
  });

  it("returns the shares registry name once sharing is bound, and follows a stored display name change", async () => {
    await writeMemberName('Ada');
    const spaces = pageSpaces();
    const shares = createPageShares({ logger } as never);
    spaces.bindSharing({} as SpaceSharingPort, shares);
    await flush();
    expect(spaces.author()).toBe('Ada');
    await writeMemberName('Bea');
    expect(shares.name()).toBe('Bea');
    expect(spaces.author()).toBe('Bea');
    await shares.closeAll();
    spaces.dispose();
  });

  it('gives serveSpaces an author getter read at each use', async () => {
    let name = 'Ada';
    const markSeen = jest.fn(async () => undefined);
    const store = { onChange: () => () => undefined, markSeen, list: () => [] } as unknown as SpaceStore;
    const port = { onLibraryChange: () => () => undefined, onProjectsChange: () => () => undefined } as unknown as SpacesHostPort;
    const ctx = { spaces: { store, port, author: () => name } as never, logger, fs: {} as never };
    let post: ((message: never) => void) | undefined;
    const tab = mountSpacesTab({} as HTMLElement, ctx, (_host, ui) => { post = (message) => ui.post(message); return () => undefined; });
    name = 'Bea';
    post!({ type: 'markSeen', id: 's', path: 'discussions/a.qmd' } as never);
    await flush();
    expect(markSeen).toHaveBeenCalledWith('s', 'discussions/a.qmd', 'Bea');
    tab.dispose();
  });
});
