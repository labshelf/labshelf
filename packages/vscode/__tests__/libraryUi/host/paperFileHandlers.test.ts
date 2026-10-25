/** The list host answers the file-tray messages: listing, describing, opening beside, revealing and copying a path. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { onPaperFileMessage } from '../../../src/libraryUi/host/paperFileHandlers';
import type { ListHostContext } from '../../../src/libraryUi/host/hostContext';

const ready = { status: 'ready', files: [{ name: 'paper.pdf', kind: 'file', modified: '2026-01-01T00:00:00.000Z', size: 4 }] } as const;
const PAPER = { id: 'p1', path: '/lib/papers/p1' };

function context(withPort = true) {
  const post = jest.fn(async (_message: unknown) => undefined);
  const notice = jest.fn();
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const paperFiles = {
    list: jest.fn(async (_id: string) => ready as unknown),
    describe: jest.fn(async (_id: string, _name: string, _description: string) => ready as unknown),
  };
  const deps = { pathOps: path, logger, ...(withPort ? { paperFiles } : {}) };
  const papers = async (ids: readonly string[]) => (ids.includes('p1') ? [PAPER] : []);
  const ctx = { deps, paths: () => ({ root: '/lib/papers' }), post, notice, papers } as unknown as ListHostContext;
  return { ctx, post, notice, logger, paperFiles };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('onPaperFileMessage', () => {
  it('returns false for a message that is not about a paper file', async () => {
    const { ctx, post } = context();
    expect(await onPaperFileMessage(ctx, { type: 'paper.details', id: 'p1' })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('paper.files replies with the listing from the port', async () => {
    const { ctx, post, paperFiles } = context();
    expect(await onPaperFileMessage(ctx, { type: 'paper.files', id: 'p1' })).toBe(true);
    expect(paperFiles.list).toHaveBeenCalledWith('p1');
    expect(post).toHaveBeenCalledWith({ type: 'files', id: 'p1', state: ready });
  });

  it('paper.files replies failed and logs when the port is absent', async () => {
    const { ctx, post, logger } = context(false);
    expect(await onPaperFileMessage(ctx, { type: 'paper.files', id: 'p1' })).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: 'files', id: 'p1', state: expect.objectContaining({ status: 'failed' }) });
    expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(String), expect.objectContaining({ id: 'p1' }));
  });

  it('paper.files replies failed and logs the paper id when the port throws', async () => {
    const { ctx, post, logger, paperFiles } = context();
    paperFiles.list.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    expect(await onPaperFileMessage(ctx, { type: 'paper.files', id: 'p1' })).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: 'files', id: 'p1', state: { status: 'failed', message: 'EACCES: permission denied' } });
    expect(logger.log).toHaveBeenCalledWith('ERROR', expect.any(String), expect.any(String), { id: 'p1', message: 'EACCES: permission denied' });
  });

  it('paper.describeFile stores the description and replies with the fresh listing', async () => {
    const { ctx, post, paperFiles } = context();
    expect(await onPaperFileMessage(ctx, { type: 'paper.describeFile', id: 'p1', name: 'data.csv', description: 'raw runs' })).toBe(true);
    expect(paperFiles.describe).toHaveBeenCalledWith('p1', 'data.csv', 'raw runs');
    expect(post).toHaveBeenCalledWith({ type: 'files', id: 'p1', state: ready });
  });

  it('paper.describeFile passes an empty description through so the entry is removed', async () => {
    const { ctx, paperFiles } = context();
    await onPaperFileMessage(ctx, { type: 'paper.describeFile', id: 'p1', name: 'data.csv', description: '' });
    expect(paperFiles.describe).toHaveBeenCalledWith('p1', 'data.csv', '');
  });

  it('paper.describeFile shows an error notice and posts nothing when the port refuses', async () => {
    const { ctx, post, notice, paperFiles } = context();
    paperFiles.describe.mockResolvedValueOnce(undefined);
    expect(await onPaperFileMessage(ctx, { type: 'paper.describeFile', id: 'p1', name: 'gone.txt', description: 'x' })).toBe(true);
    expect(notice).toHaveBeenCalledWith('error', expect.stringContaining('gone.txt'));
    expect(post).not.toHaveBeenCalled();
  });

  it('paper.describeFile replies failed when the port is absent', async () => {
    const { ctx, post } = context(false);
    await onPaperFileMessage(ctx, { type: 'paper.describeFile', id: 'p1', name: 'a', description: 'b' });
    expect(post).toHaveBeenCalledWith({ type: 'files', id: 'p1', state: expect.objectContaining({ status: 'failed' }) });
  });

  it('paper.openFile opens a file beside the list', async () => {
    const { ctx } = context();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: vscode.FileType.File });
    expect(await onPaperFileMessage(ctx, { type: 'paper.openFile', id: 'p1', name: 'data.csv' })).toBe(true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', vscode.Uri.file('/lib/papers/p1/data.csv'), vscode.ViewColumn.Beside);
  });

  it('paper.openFile reveals a folder in the explorer', async () => {
    const { ctx } = context();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: vscode.FileType.Directory });
    await onPaperFileMessage(ctx, { type: 'paper.openFile', id: 'p1', name: 'figures' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealInExplorer', vscode.Uri.file('/lib/papers/p1/figures'));
  });

  it('paper.revealFile reveals the entry in the operating system', async () => {
    const { ctx } = context();
    expect(await onPaperFileMessage(ctx, { type: 'paper.revealFile', id: 'p1', name: 'data.csv' })).toBe(true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('revealFileInOS', vscode.Uri.file('/lib/papers/p1/data.csv'));
  });

  it('paper.copyFilePath writes the absolute path to the clipboard', async () => {
    const { ctx } = context();
    expect(await onPaperFileMessage(ctx, { type: 'paper.copyFilePath', id: 'p1', name: 'data.csv' })).toBe(true);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/lib/papers/p1/data.csv');
  });

  it.each(['paper.openFile', 'paper.revealFile', 'paper.copyFilePath'] as const)('%s on an unknown paper does nothing', async (type) => {
    const { ctx } = context();
    await onPaperFileMessage(ctx, { type, id: 'nope', name: 'a' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it.each(['../secret', 'a/b', '..'])('refuses the name %j that leaves the paper folder', async (name) => {
    const { ctx, notice } = context();
    await onPaperFileMessage(ctx, { type: 'paper.revealFile', id: 'p1', name });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith('error', expect.any(String));
  });
});
