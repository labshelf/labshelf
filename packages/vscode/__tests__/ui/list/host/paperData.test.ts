/** The detail pane's PDF line shows the file's path relative to papers/, in the app's path style. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sendDetails } from '../../../../src/ui/list/host/paperData';
import type { ListHostContext } from '../../../../src/ui/list/host/hostContext';

const ROOT = '/lib/papers';

function context(paperPath: string, root: string | null = ROOT) {
  const post = jest.fn(async () => undefined);
  const ctx = {
    deps: { pathOps: path, logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } },
    paths: () => (root ? { root } : null),
    papers: async () => [{ id: 'p1', title: 'T', path: paperPath }],
    post,
  } as unknown as ListHostContext;
  return { ctx, post };
}

describe('sendDetails pdf line', () => {
  it('names the PDF relative to papers/', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: vscode.FileType.File, size: 1234 });
    const { ctx, post } = context(`${ROOT}/ML/Refs/p1`);

    await sendDetails(ctx, 'p1');

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: 'details',
      details: expect.objectContaining({ pdf: { size: 1234, relPath: 'ML/Refs/p1/paper.pdf' } }),
    }));
  });

  it('names the PDF by its file name while no library is configured', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: vscode.FileType.File, size: 5 });
    const { ctx, post } = context(`${ROOT}/p1`, null);

    await sendDetails(ctx, 'p1');

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ pdf: { size: 5, relPath: 'paper.pdf' } }),
    }));
  });
});
