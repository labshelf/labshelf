/** The sync target of an on-disk library: roots, state files and the shared lock, resolved to filesystem paths. */
import { libraryLayout } from '../../../src/library/index';
import type { LocalFileSystem, LockStore } from '../../../src/ports/index';
import { diskSyncTarget } from '../../../src/sync/coordinator/diskSyncTarget';

interface Uri { fsPath: string }

describe('diskSyncTarget', () => {
  it('points the engine at the layout\'s roots, manifest, run record and lock as filesystem paths', () => {
    const files = {} as LocalFileSystem;
    const store = {} as LockStore;
    const isProcessAlive = (): boolean => true;
    const layout = libraryLayout<Uri>({ fsPath: '/lib' }, (base, ...segments) => ({ fsPath: [base.fsPath, ...segments].join('/') }));

    const target = diskSyncTarget({ files, layout, toPath: (uri) => uri.fsPath, lock: { store, isProcessAlive } });

    expect(target.files).toBe(files);
    expect(target.roots).toEqual({ library: '/lib/papers', appdata: '/lib/.research/papers' });
    expect(target.state).toEqual({
      fs: files,
      manifestPath: '/lib/.research/sync/google-drive.state.json',
      lastRunPath: '/lib/.research/sync/google-drive.last.json',
    });
    expect(target.lock).toEqual({ store, isProcessAlive, path: '/lib/.research/sync/google-drive.lock' });
  });
});
