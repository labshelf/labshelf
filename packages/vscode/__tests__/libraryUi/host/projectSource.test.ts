/** The list host answers the detail pane's "Cited in": the citing projects with each paper, and opening a source at its line. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { answerListMessage } from '../../../src/libraryUi/host/listHandlers';
import { sendDetails } from '../../../src/libraryUi/host/answerDetailPane';
import type { ListHostContext } from '../../../src/libraryUi/host/hostContext';

const link = { project: 'survey', file: 'sections/intro.tex', line: 11, section: 'Intro' };

function context(folder: string | undefined = '/lib/projects/survey') {
  const post = jest.fn(async () => undefined);
  const notice = jest.fn();
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const ctx = {
    deps: {
      pathOps: path, logger,
      projectBacklinks: { index: () => new Map([['smith2020', [link]]]), projectFolder: (id: string) => (id === 'survey' ? folder : undefined), onDidChange: jest.fn() },
    },
    paths: () => ({ root: '/lib/papers' }),
    papers: async () => [{ id: 'p1', title: 'T', path: '/lib/papers/p1', citeKey: 'smith2020' }],
    post, notice,
  } as unknown as ListHostContext;
  return { ctx, post, notice, logger };
}

const showTextDocument = vscode.window.showTextDocument as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File, size: 1 });
});

describe('details citedIn', () => {
  it('lists the projects citing the paper by its cite key', async () => {
    const { ctx, post } = context();
    await sendDetails(ctx, 'p1');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'details', details: expect.objectContaining({ citedIn: [link] }) }));
  });

  it('sends an empty list for a paper no project cites', async () => {
    const { ctx, post } = context();
    (ctx.papers as unknown) = async () => [{ id: 'p2', title: 'T', path: '/lib/papers/p2', citeKey: 'nobody' }];
    await sendDetails(ctx, 'p2');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ citedIn: [] }) }));
  });
});

describe('project.openSource', () => {
  const open = (ctx: ListHostContext, file: string, project = 'survey') =>
    answerListMessage(ctx, { type: 'project.openSource', project, file, line: 11 });

  it('opens the file below the project folder with the cursor on the line', async () => {
    const { ctx } = context();
    await open(ctx, 'sections/intro.tex');
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const [uri, options] = showTextDocument.mock.calls[0]!;
    expect(uri.fsPath).toBe('/lib/projects/survey/sections/intro.tex');
    expect(options.selection.start).toMatchObject({ line: 11, character: 0 });
  });

  it('refuses a path that leaves the project folder, even past the message guard', async () => {
    const { ctx, logger } = context();
    await answerListMessage(ctx, { type: 'project.openSource', project: 'survey', file: '../secret.tex', line: 0 });
    expect(showTextDocument).not.toHaveBeenCalled();
    const { ctx: direct, logger: directLogger } = context();
    await (await import('../../../src/libraryUi/host/projectSource')).openProjectSource(direct, 'survey', '../../etc/passwd', 0);
    expect(showTextDocument).not.toHaveBeenCalled();
    expect(directLogger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.stringContaining('outside'), expect.anything());
    expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.stringContaining('not valid'), expect.anything());
  });

  it('tells the user when the project is gone', async () => {
    const { ctx, notice } = context();
    await open(ctx, 'main.tex', 'deleted');
    expect(showTextDocument).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith('error', expect.stringContaining('deleted'));
  });
});
