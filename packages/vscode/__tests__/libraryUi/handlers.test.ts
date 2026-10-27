/** The list host's message handlers: sharing and Space messages, the detail pane, the file tray and project sources. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { answerListMessage, answerSidebarSpaceMessage, onPaperFileMessage, openProjectSource, sendDetails } from '../../src/libraryUi/handlers';
import type { ListHostContext } from '../../src/libraryUi/handlers';

describe('answerListMessage', () => {
  function context() {
    const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
    const ctx = { deps: { logger }, paths: () => null, post: jest.fn(), notice: jest.fn() } as unknown as ListHostContext;
    return { ctx, logger };
  }

  describe('answerListMessage', () => {
    it('ignores a sharing message without a warning', async () => {
      const { ctx, logger } = context();
      await answerListMessage(ctx, { channel: 'sharing', type: 'hello' });
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('warns about a message that is not valid', async () => {
      const { ctx, logger } = context();
      await answerListMessage(ctx, { type: 'nonsense' });
      expect(logger.log).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(String), { type: 'nonsense' });
    });
  });


  it('adds paper references through the Space host and confirms success', async () => {
    const { ctx } = context();
    ctx.deps.addToSpace = jest.fn(async () => true);
    await answerListMessage(ctx, { type: 'paper.addToSpace', ids: ['paper-a'] });
    expect(ctx.deps.addToSpace).toHaveBeenCalledWith(['paper-a']);
    expect(ctx.notice).toHaveBeenCalledWith('ok', 'Added to Space');
  });

  it('surfaces failures adding paper references', async () => {
    const { ctx, logger } = context();
    ctx.deps.addToSpace = jest.fn(async () => { throw new Error('Disk unavailable'); });
    await answerListMessage(ctx, { type: 'paper.addToSpace', ids: ['paper-a'] });
    expect(logger.log).toHaveBeenCalledWith('ERROR', expect.any(String), expect.any(String), expect.any(Object));
    expect(ctx.notice).toHaveBeenCalledWith('error', expect.stringContaining('Disk unavailable'));
  });
});

describe('answerDetailPane', () => {
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
});

describe('paperFiles', () => {
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
});

describe('projectSource', () => {
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
      await openProjectSource(direct, 'survey', '../../etc/passwd', 0);
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
});

describe('spaces', () => {
  it("leaves the prior Space unchanged after a root switch during rename", async () => {
    const renameSpace = jest.fn();
    const binding = { store: { read: async () => ({ state: "ready", space: { name: "Research" } }), renameSpace },
      logger: { error: jest.fn() } };
    let current: typeof binding | undefined = binding;
    (vscode.window.showInputBox as jest.Mock).mockImplementationOnce(async () => { current = undefined; return "Work"; });
    await answerSidebarSpaceMessage({ type: "spaceAction", action: "renameSpace", id: "research" }, { current: () => current } as never);
    expect(renameSpace).not.toHaveBeenCalled();
    expect(binding.logger.error).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("library changed"));
  });
});
