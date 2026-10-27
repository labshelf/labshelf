import * as path from 'node:path';
import * as vscode from 'vscode';
import { createLibraryLayout } from '@labshelf/core';
import { ExternalChangeWatcher, VscodeFileSystem } from '../../src/library/fileSystem';

const TMP = '/lib/.research/tmp';
const wfs = vscode.workspace.fs as unknown as Record<string, jest.Mock>;

function makeFs(): VscodeFileSystem {
  return new VscodeFileSystem('/lib', path, vscode.Uri.file);
}

function notFound(): Error {
  return Object.assign(new Error('EntryNotFound'), { code: 'FileNotFound' });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ['writeFile', 'createDirectory', 'delete', 'rename']) {
    wfs[name]!.mockReset().mockResolvedValue(undefined);
  }
});

describe('VscodeFileSystem.ensureDir', () => {
  it('creates the directory through workspace.fs', async () => {
    await makeFs().ensureDir('/tmp/test-dir');
    expect(wfs['createDirectory']).toHaveBeenCalledWith(vscode.Uri.file('/tmp/test-dir'));
  });

  it('wraps a failure with the path', async () => {
    wfs['createDirectory']!.mockRejectedValue(new Error('EACCES'));
    await expect(makeFs().ensureDir('/tmp/no-perm')).rejects.toThrow('Failed to ensure directory /tmp/no-perm: EACCES');
  });
});

describe('VscodeFileSystem atomic writes', () => {
  it('writes a dot-prefixed temp file in the tmp folder and renames it over the target', async () => {
    await makeFs().writeText('/lib/papers/p1/metadata.yaml', 'héllo');

    const [tmp, content] = wfs['writeFile']!.mock.calls[0] as [vscode.Uri, Uint8Array];
    expect(tmp.fsPath).toMatch(/^\/lib\/\.research\/tmp\/\.metadata\.yaml\.[0-9a-f-]{36}\.tmp$/);
    expect(Buffer.from(content).toString('utf8')).toBe('héllo');
    expect(wfs['rename']).toHaveBeenCalledWith(tmp, vscode.Uri.file('/lib/papers/p1/metadata.yaml'), { overwrite: true });
    expect(wfs['writeFile']).toHaveBeenCalledTimes(1);
  });

  it('creates the target folder and the tmp folder first', async () => {
    await makeFs().writeFile('/lib/papers/new/f.bin', new Uint8Array([1]));
    const created = wfs['createDirectory']!.mock.calls.map(([uri]: [vscode.Uri]) => uri.fsPath);
    expect(created).toEqual(['/lib/papers/new', TMP]);
  });

  it('stages a write outside the library next to its target, so the rename never crosses volumes', async () => {
    await makeFs().writeText('/cache/libraries/k/openalex/W1.json', '{}');
    const tmp = (wfs['writeFile']!.mock.calls[0] as [vscode.Uri])[0];
    expect(tmp.fsPath).toMatch(/^\/cache\/libraries\/k\/openalex\/\.W1\.json\.[0-9a-f-]{36}\.tmp$/);
  });

  it('removes the temp file and rejects with the path when the rename fails', async () => {
    wfs['rename']!.mockRejectedValue(new Error('EBUSY'));

    await expect(makeFs().writeText('/lib/papers/p1/data.json', '{}')).rejects.toThrow('Failed to write /lib/papers/p1/data.json: EBUSY');

    const tmp = (wfs['writeFile']!.mock.calls[0] as [vscode.Uri])[0];
    expect(wfs['delete']).toHaveBeenCalledWith(tmp, { useTrash: false });
  });

  it('removes the temp file when writing it fails', async () => {
    wfs['writeFile']!.mockRejectedValue(new Error('ENOSPC'));

    await expect(makeFs().writeFile('/lib/f.bin', new Uint8Array([1]))).rejects.toThrow('ENOSPC');

    expect(wfs['delete']).toHaveBeenCalledTimes(1);
    expect(wfs['rename']).not.toHaveBeenCalled();
  });
});

describe('VscodeFileSystem reads', () => {
  it('readText keeps a leading byte-order mark, as the Node decoder did', async () => {
    wfs['readFile']!.mockResolvedValue(Buffer.from('\uFEFFname: x', 'utf8'));
    expect(await makeFs().readText('/lib/a.yaml')).toBe('\uFEFFname: x');
  });

  it('writeText stores UTF-8 bytes', async () => {
    await makeFs().writeText('/lib/a.txt', 'wörld');
    expect([...(wfs['writeFile']!.mock.calls[0] as [vscode.Uri, Uint8Array])[1]]).toEqual([...Buffer.from('wörld', 'utf8')]);
  });

  it('readText decodes UTF-8 and readFile returns the bytes', async () => {
    wfs['readFile']!.mockResolvedValue(Buffer.from('wörld', 'utf8'));
    expect(await makeFs().readText('/lib/a.txt')).toBe('wörld');
    expect([...(await makeFs().readFile('/lib/a.txt'))]).toEqual([...Buffer.from('wörld', 'utf8')]);
  });

  it('exists is true for files and folders, false when stat fails', async () => {
    wfs['stat']!.mockResolvedValueOnce({ type: vscode.FileType.Directory, mtime: 0, size: 0 });
    expect(await makeFs().exists('/lib/papers')).toBe(true);
    wfs['stat']!.mockRejectedValueOnce(notFound());
    expect(await makeFs().exists('/lib/missing')).toBe(false);
  });

  it('listDir returns the names, and [] for a missing folder', async () => {
    wfs['readDirectory']!.mockResolvedValueOnce([['a.pdf', vscode.FileType.File], ['sub', vscode.FileType.Directory]]);
    expect(await makeFs().listDir('/lib')).toEqual(['a.pdf', 'sub']);
    wfs['readDirectory']!.mockRejectedValue(notFound());
    expect(await makeFs().listDir('/lib/missing')).toEqual([]);
  });

  it('listDir throws for a folder it may not read, so an import can report it', async () => {
    wfs['readDirectory']!.mockRejectedValue(Object.assign(new Error('NoPermissions'), { code: 'NoPermissions' }));
    await expect(makeFs().listDir('/lib/locked')).rejects.toThrow('NoPermissions');
  });

  it('stat reports file and folder types strictly, and undefined on error', async () => {
    wfs['stat']!.mockResolvedValueOnce({ type: vscode.FileType.File, mtime: 5, size: 7 });
    expect(await makeFs().stat('/lib/a')).toEqual({ isFile: true, isDirectory: false, mtimeMs: 5, size: 7 });
    wfs['stat']!.mockResolvedValueOnce({ type: vscode.FileType.Directory, mtime: 1, size: 0 });
    expect(await makeFs().stat('/lib')).toMatchObject({ isFile: false, isDirectory: true });
    wfs['stat']!.mockResolvedValueOnce({ type: vscode.FileType.File | vscode.FileType.SymbolicLink, mtime: 1, size: 0 });
    expect(await makeFs().stat('/lib/link')).toMatchObject({ isFile: false, isDirectory: false });
    wfs['stat']!.mockRejectedValueOnce(notFound());
    expect(await makeFs().stat('/lib/missing')).toBeUndefined();
  });
});

describe('VscodeFileSystem.deleteFile', () => {
  it('deletes without the trash', async () => {
    await makeFs().deleteFile('/lib/a.pdf');
    expect(wfs['delete']).toHaveBeenCalledWith(vscode.Uri.file('/lib/a.pdf'), { useTrash: false });
  });

  it('resolves silently for a file that is already gone', async () => {
    wfs['delete']!.mockRejectedValue(notFound());
    await expect(makeFs().deleteFile('/lib/gone.pdf')).resolves.toBeUndefined();
  });

  it('still throws every other error', async () => {
    wfs['delete']!.mockRejectedValue(Object.assign(new Error('NoPermissions'), { code: 'NoPermissions' }));
    await expect(makeFs().deleteFile('/lib/locked.pdf')).rejects.toThrow('NoPermissions');
  });
});

describe('VscodeFileSystem library operations', () => {
  it('renames without overwriting', async () => {
    await makeFs().rename('/lib/papers/ml', '/lib/papers/ML');
    expect(wfs['rename']).toHaveBeenCalledWith(vscode.Uri.file('/lib/papers/ml'), vscode.Uri.file('/lib/papers/ML'), { overwrite: false });
  });

  it('trashes a folder recursively through the platform trash', async () => {
    await makeFs().trash('/lib/papers/p1');
    expect(wfs['delete']).toHaveBeenCalledWith(vscode.Uri.file('/lib/papers/p1'), { recursive: true, useTrash: true });
  });

  it('passes a trash failure on', async () => {
    wfs['delete']!.mockRejectedValue(new Error('NoPermissions'));
    await expect(makeFs().trash('/lib/papers/p1')).rejects.toThrow('NoPermissions');
  });

  it('creates a folder with mkdir', async () => {
    await makeFs().mkdir('/lib/papers/New');
    expect(wfs['createDirectory']).toHaveBeenCalledWith(vscode.Uri.file('/lib/papers/New'));
  });
});

const watchers = (vscode as unknown as { _fileWatchers: Array<{ pattern: { base: vscode.Uri; pattern: string }; _fire(kind: string, uri: vscode.Uri): void; dispose: jest.Mock }> })._fileWatchers;

beforeEach(() => {
  watchers.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ExternalChangeWatcher', () => {
  it('watches the papers folder, the sidecars and the projects folder', () => {
    const watcher = new ExternalChangeWatcher(createLibraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), jest.fn());
    expect(watchers.map((w) => [w.pattern.base.fsPath, w.pattern.pattern])).toEqual([
      ['/lib/papers', '**'],
      ['/lib/.research/papers', '**/data.json'],
      ['/lib/projects', '**'],
    ]);
    watcher.dispose();
    expect(watchers.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('coalesces a burst of file events into one callback', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(createLibraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 500);
    for (let i = 0; i < 20; i++) {
      watchers[0]!._fire('create', vscode.Uri.file(`/lib/papers/ml/p${i}/metadata.yaml`));
    }
    watchers[1]!._fire('change', vscode.Uri.file('/lib/.research/papers/p1/data.json'));
    jest.advanceTimersByTime(499);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });

  it('ignores the hidden temp files of atomic writes', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(createLibraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 10);
    watchers[0]!._fire('create', vscode.Uri.file('/lib/papers/p/.metadata.yaml.123.tmp'));
    watchers[0]!._fire('change', vscode.Uri.file('/lib/papers/.DS_Store'));
    watchers[0]!._fire('change', vscode.Uri.file('/lib/papers/p/a~'));
    watchers[0]!._fire('change', vscode.Uri.file('/lib/papers/p/a.swp'));
    jest.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it('stops calling back after dispose', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(createLibraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 10);
    watchers[0]!._fire('delete', vscode.Uri.file('/lib/papers/p/metadata.yaml'));
    watcher.dispose();
    jest.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
  });
});
