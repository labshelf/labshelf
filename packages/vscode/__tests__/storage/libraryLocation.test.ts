import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sharedConfigPath, updateSharedConfig } from '@labshelf/core/node';
import {
  resolveLibraryRoot,
  ensureLibraryStructure,
} from '../../src/storage/paths/libraryLocation';
import { VscodeFileSystem } from '../../src/storage/vscodeFileSystem';
import { nodeSharedLibraryConfig as shared } from '../../src/storage/node/index';

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

const fsService = new VscodeFileSystem('/tmp/mylib', path, vscode.Uri.file);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(sharedConfigPath(), { force: true, recursive: true });
});

// ─── resolveLibraryRoot ────────────────────────────────────────────────────────

describe('resolveLibraryRoot', () => {
  it('returns undefined when the shared config has no root', async () => {
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('returns undefined when the stored path is not a directory', async () => {
    await updateSharedConfig({ libraryRoot: '/tmp/some-path' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('returns undefined when stat throws (path inaccessible)', async () => {
    await updateSharedConfig({ libraryRoot: '/tmp/nonexistent' });
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('opens the root any app recorded in the shared config', async () => {
    await updateSharedConfig({ libraryRoot: '/Users/me/FromTerminal' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    expect((await resolveLibraryRoot(shared))?.fsPath).toBe('/Users/me/FromTerminal');
  });
});

// ─── ensureLibraryStructure ───────────────────────────────────────────────────

describe('ensureLibraryStructure', () => {
  it('creates .research/, .research/papers/ and papers/ directories', async () => {
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const root = makeUri('/tmp/mylib');

    await ensureLibraryStructure(root, fsService);

    const created = (vscode.workspace.fs.createDirectory as jest.Mock).mock.calls.map(
      ([uri]: [vscode.Uri]) => uri.fsPath,
    );
    expect(created.some(p => p.endsWith('.research'))).toBe(true);
    expect(created.some(p => p.endsWith('logs'))).toBe(false);
    expect(created.some(p => p.endsWith('papers'))).toBe(true);
  });
});
