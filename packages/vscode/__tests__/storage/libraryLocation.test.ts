import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readSharedLibraryRoot, sharedConfigPath, updateSharedConfig } from '@labshelf/core/node';
import {
  resolveLibraryRoot,
  ensureLibraryStructure,
  runLibrarySetupWizard,
} from '../../src/storage/paths/libraryLocation';
import { VscodeFileSystem } from '../../src/storage/vscodeFileSystem';
import { nodeSharedLibraryConfig as shared } from '../../src/storage/node/index';

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

const fsService = new VscodeFileSystem('/tmp/mylib/.research/tmp', path);
const createFileSystem = () => fsService;

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
  it('creates .research/, .research/logs/, and papers/ directories', async () => {
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const root = makeUri('/tmp/mylib');

    await ensureLibraryStructure(root, fsService);

    const created = (vscode.workspace.fs.createDirectory as jest.Mock).mock.calls.map(
      ([uri]: [vscode.Uri]) => uri.fsPath,
    );
    expect(created.some(p => p.endsWith('.research'))).toBe(true);
    expect(created.some(p => p.endsWith('logs'))).toBe(true);
    expect(created.some(p => p.endsWith('papers'))).toBe(true);
  });
});

// ─── runLibrarySetupWizard ────────────────────────────────────────────────────

describe('runLibrarySetupWizard', () => {
  it('returns undefined when user cancels folder dialog', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    const result = await runLibrarySetupWizard(shared, createFileSystem);
    expect(result).toBeUndefined();
    expect(await readSharedLibraryRoot()).toBeUndefined();
  });

  it('returns undefined when user cancels name input', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    const result = await runLibrarySetupWizard(shared, createFileSystem);
    expect(result).toBeUndefined();
    expect(await readSharedLibraryRoot()).toBeUndefined();
  });

  it('returns the configured Uri and persists it when wizard completes', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('MyLibrary');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const result = await runLibrarySetupWizard(shared, createFileSystem);

    expect(result).toBeDefined();
    expect(result!.fsPath).toContain('MyLibrary');
    expect(await readSharedLibraryRoot()).toBe(result!.fsPath);
  });

  it('returns undefined and shows error message when directory creation fails', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('BadLib');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error('EACCES'));
    const result = await runLibrarySetupWizard(shared, createFileSystem);

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(await readSharedLibraryRoot()).toBeUndefined();
  });

  it('returns undefined and shows an error when the shared config cannot be written', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('MyLibrary');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    // A directory in place of the file makes the atomic rename fail.
    fs.mkdirSync(sharedConfigPath(), { recursive: true });

    const result = await runLibrarySetupWizard(shared, createFileSystem);

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
