/** The VS Code sharing host speaks library paths to the dialogs and disk paths to the core folder-link operations. */
import * as path from 'node:path';
import type { ShareHost } from '@labshelf/core';
import { withLibraryPaths } from '../../../src/share/node/createVscodeShareHost';
import { createLibraryPaths } from '../../../src/libraryUi/createLibraryPaths';

const root = '/lib/papers';

function host() {
  const inner = {
    shareableFolder: jest.fn(async (dir: string) => ({ path: dir, label: 'ML', count: 2 })),
    shareFolder: jest.fn(async () => ({ kind: 'shared' as const, link: 'https://x' })),
    openFolder: jest.fn(async () => undefined),
    importLink: jest.fn(async () => ({ kind: 'imported' as const, summary: 'Added 1', folder: '/lib/papers/Shared' })),
    sharedLinks: jest.fn(async () => [
      { id: 'a', folder: '/lib/papers/ML/2024', link: 'l', createdAt: 't', relayHost: 'h' },
      { id: 'b', folder: '/elsewhere/X', link: 'l', createdAt: 't', relayHost: 'h' },
    ]),
  };
  return { inner, wrapped: withLibraryPaths(inner as unknown as ShareHost, () => createLibraryPaths(root, path.posix)) };
}

describe('withLibraryPaths', () => {
  it('maps library paths to disk paths on the way in and back on the way out', async () => {
    const { inner, wrapped } = host();
    expect(await wrapped.shareableFolder('papers/ML')).toEqual({ path: 'papers/ML', label: 'ML', count: 2 });
    expect(inner.shareableFolder).toHaveBeenCalledWith('/lib/papers/ML');
    const onProgress = jest.fn();
    await wrapped.shareFolder('papers/ML/2024', true, onProgress);
    expect(inner.shareFolder).toHaveBeenCalledWith('/lib/papers/ML/2024', true, onProgress);
    await wrapped.openFolder('papers');
    expect(inner.openFolder).toHaveBeenCalledWith(root);
    expect(await wrapped.importLink('link', onProgress)).toEqual({ kind: 'imported', summary: 'Added 1', folder: 'papers/Shared' });
    expect((await wrapped.sharedLinks()).map((link) => link.folder)).toEqual(['papers/ML/2024', '/elsewhere/X']);
  });

  it('rejects a path that does not map into the library', async () => {
    const { inner, wrapped } = host();
    await expect(wrapped.shareFolder('papers/../secrets', false, jest.fn())).rejects.toThrow('outside the library');
    await expect(wrapped.openFolder('research/x')).rejects.toThrow('outside the library');
    await expect(wrapped.shareableFolder('/etc')).rejects.toThrow('outside the library');
    expect(inner.shareFolder).not.toHaveBeenCalled();
    expect(inner.openFolder).not.toHaveBeenCalled();
    expect(inner.shareableFolder).not.toHaveBeenCalled();
  });
});
