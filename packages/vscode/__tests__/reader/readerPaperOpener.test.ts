import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PdfViewerPanel, type PdfViewerDeps } from '../../src/reader/readerPaperOpener';
import { ReaderPanel } from '../../src/reader/ReaderPanel';
import { makeMemoryPaperDataStore } from '../support/memorySidecarPort';
import { statFromDisk } from '../support/diskStat';
import { createLibraryEvents } from '../../src/library/index.js';

const vscode = require('vscode');

let _paperId = 0;
function nextPaperId() { return `paper-${++_paperId}`; }

function makePaper(overrides: Record<string, unknown> = {}) {
  const id = nextPaperId();
  return {
    id,
    title: 'Test Paper',
    path: `/papers/${id}`,
    citeKey: 'test2026',
    authors: ['Ana Silva', 'Rui Costa', 'Li Wei'],
    year: 2026,
    status: 'unread' as const,
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PdfViewerPanel', () => {
  let extensionDir: string;

  beforeAll(() => {
    statFromDisk();
    extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-panel-'));
    fs.mkdirSync(path.join(extensionDir, 'dist', 'reader'), { recursive: true });
    fs.writeFileSync(path.join(extensionDir, 'dist', 'reader', 'reader.js'), '// bundle');
  });
  afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });

  beforeEach(() => {
    ReaderPanel._clearAllForTesting();
    jest.clearAllMocks();
    vscode.window.activeColorTheme = { kind: 2 };
    for (const key of Object.keys(vscode.workspace._config)) { delete vscode.workspace._config[key]; }
  });

  function makeDeps(overrides: Partial<PdfViewerDeps> = {}) {
    const store = makeMemoryPaperDataStore();
    const events = createLibraryEvents();
    const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as any;
    const deps: PdfViewerDeps = {
      extensionUri: vscode.Uri.file(extensionDir),
      events,
      store,
      logger,
      locatePdfjs: () => null,
      isMac: false,
      ...overrides,
    };
    return { deps, store, events, logger };
  }

  function lastPanel() {
    const results = (vscode.window.createWebviewPanel as jest.Mock).mock.results;
    const panel = results[results.length - 1]?.value;
    if (!panel) { throw new Error('No panel was created'); }
    return panel;
  }

  function open(overrides: Partial<PdfViewerDeps> = {}, paperOverrides: Record<string, unknown> = {}) {
    const ctx = makeDeps(overrides);
    const paper = makePaper(paperOverrides);
    PdfViewerPanel.createOrShow(ctx.deps, paper);
    return { ...ctx, paper, panel: lastPanel() };
  }

  const posted = (panel: any, type: string) =>
    (panel.webview.postMessage as jest.Mock).mock.calls.map((c) => c[0]).filter((m) => m.type === type);

  describe('createOrShow', () => {
    it('creates a script-enabled panel in the active group by default', () => {
      const { paper } = open();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'labshelfPdf',
        paper.title,
        vscode.ViewColumn.Active,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('opens beside the editor when labshelf.reader.openBeside is true', () => {
      vscode.workspace._config['labshelf.reader'] = { openBeside: true };
      open();
      expect((vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[2]).toBe(vscode.ViewColumn.Two);
    });

    it('never enables the VS Code find widget, which would swallow Ctrl+F', () => {
      open();
      const options = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[3];
      expect(options.enableFindWidget).toBeUndefined();
    });

    it('restricts localResourceRoots to the bundle, the paper folder and pdf.js', () => {
      const { paper } = open();
      const roots: string[] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[3]
        .localResourceRoots.map((u: any) => u.fsPath);
      expect(roots).toContain(path.join(extensionDir, 'dist', 'reader'));
      expect(roots).toContain(paper.path);
      expect(roots).not.toContain(extensionDir);
    });

    it('lets the webview read the located pdf.js package root', () => {
      const pdfjs = vscode.Uri.file('/pdfjs');
      open({ locatePdfjs: () => ({ pdfjs, worker: pdfjs, viewer: pdfjs, viewerCss: pdfjs, root: pdfjs }) });
      const roots: string[] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[3]
        .localResourceRoots.map((u: any) => u.fsPath);
      expect(roots).toContain('/pdfjs');
    });

    it('assigns the HTML shell without waiting for the sidecar or any other disk read', async () => {
      const ctx = makeDeps();
      jest.spyOn(ctx.store, 'load').mockImplementation(() => new Promise(() => {}));
      PdfViewerPanel.createOrShow(ctx.deps, makePaper());
      await flush();
      const html: string = lastPanel().webview.html;
      expect(html).toContain('data-pdf-theme="dark"');
      expect(html).toContain(path.join('dist', 'reader', 'reader.js'));
    });

    it('announces pdfViewerClosed once when the panel closes', async () => {
      const ctx = makeDeps();
      const closed = jest.fn();
      ctx.events.pdfViewerClosed.event(closed);
      const paper = makePaper();
      PdfViewerPanel.createOrShow(ctx.deps, paper);
      lastPanel().dispose();
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ paperId: paper.id }));
    });

    it('reveals the existing ready panel and scrolls it to a requested page', async () => {
      const { deps, paper, panel } = open();
      panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
      await flush();
      const created = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.length;
      PdfViewerPanel.createOrShow(deps, paper, { page: 7 });
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(created);
      expect(panel.reveal).toHaveBeenCalled();
      expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 7 }]);
    });

    it('holds a page asked for by a reveal before the reader is ready, and scrolls there once it is', async () => {
      const { deps, paper, panel } = open();
      PdfViewerPanel.createOrShow(deps, paper, { page: 7 });
      expect(posted(panel, 'scrollToPage')).toHaveLength(0);
      panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
      await flush();
      expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 7 }]);
    });

    it('delivers a page requested at open time once the webview is ready', async () => {
      const ctx = makeDeps();
      PdfViewerPanel.createOrShow(ctx.deps, makePaper(), { page: 4 });
      const panel = lastPanel();
      expect(posted(panel, 'scrollToPage')).toHaveLength(0);
      panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
      await flush();
      expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 4 }]);
    });

    it('applies the effective theme without rebuilding the webview when VS Code theme changes in auto mode', async () => {
      const { panel } = open();
      await flush();
      const html = panel.webview.html;
      (vscode.window as any)._fireThemeChange(vscode.ColorThemeKind.Light);
      await flush();
      expect(posted(panel, 'applyTheme')).toContainEqual({ type: 'applyTheme', theme: 'auto', effectiveTheme: 'light' });
      expect(panel.webview.html).toBe(html);
    });

    it('pushes new preferences when labshelf.reader settings change', async () => {
      const { panel } = open();
      vscode.workspace._config['labshelf.reader'] = { vimKeys: true };
      vscode.workspace._fireConfigChange('labshelf.reader.vimKeys');
      await flush();
      expect(posted(panel, 'prefsChanged')[0].prefs.vimKeys).toBe(true);
    });
  });

  describe('host controller wiring', () => {
    it('answers ready-for-init from the sidecar through the shared controller', async () => {
      const { panel, store, paper } = open();
      await store.setTheme(paper.id, 'sepia');
      await store.addHighlight(paper.id, 2, 'a highlight', 'green');
      panel.webview._fireMessage({ command: 'ready-for-init' });
      await flush();
      await flush();
      const [init] = posted(panel, 'init');
      expect(init).toMatchObject({ theme: 'sepia', effectiveTheme: 'sepia', reading: null });
      expect(init.annotations).toHaveLength(1);
      expect(init.prefs.defaultZoom).toBe('page-width');
    });

    it('resolves the auto theme from the VS Code colour theme', async () => {
      const { panel } = open();
      panel.webview._fireMessage({ command: 'ready-for-init' });
      await flush();
      await flush();
      expect(posted(panel, 'init')[0]).toMatchObject({ theme: 'auto', effectiveTheme: 'dark' });
    });

    it('logs malformed messages through the injected logger', async () => {
      const { panel, logger, paper } = open();
      panel.webview._fireMessage('garbage');
      await flush();
      expect(logger.log).toHaveBeenCalledWith('WARN', 'reader', 'Ignored malformed reader message', { paperId: paper.id });
    });

    it('reads the citation style from the labshelf.reader settings', async () => {
      vscode.workspace._config['labshelf.reader'] = { citationStyle: 'citekey' };
      const { panel } = open();
      panel.webview._fireMessage({ command: 'copyWithCitation', text: 'A quoted\npassage.', pageNumber: 12 });
      await flush();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('A quoted passage. @test2026');
      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Copied with citation (@test2026, p. 12)', 2500);
    });

    it('announces annotation changes for the list and sync', async () => {
      const { panel, events, store, paper } = open();
      const changed = jest.fn();
      events.annotationChanged.event(changed);
      panel.webview._fireMessage({ command: 'createAnnotation', type: 'note', pageNumber: 2, content: 'a note' });
      await flush();
      await flush();
      const [stored] = await store.getAnnotations(paper.id);
      expect(changed).toHaveBeenCalledWith({ paperId: paper.id });
      panel.webview._fireMessage({ command: 'deleteAnnotation', id: stored!.id });
      await flush();
      await flush();
      expect(changed).toHaveBeenCalledTimes(2);
    });

    it('exports to the file chosen in the save dialog', async () => {
      const { panel } = open();
      const target = vscode.Uri.file('/tmp/out/annotations.md');
      (vscode.window.showSaveDialog as jest.Mock).mockResolvedValueOnce(target);
      panel.webview._fireMessage({ command: 'exportAnnotations', target: 'file' });
      await flush();
      await flush();
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(target, expect.anything());
    });
  });

  describe('postToActive', () => {
    it('targets the focused reader and nothing once it loses focus', () => {
      const first = open();
      const second = open();
      first.panel._fireViewState({ active: false, visible: true });
      second.panel._fireViewState({ active: true, visible: true });
      expect(ReaderPanel.postToActive('zoomIn')).toBe(true);
      expect(posted(second.panel, 'command')).toEqual([{ type: 'command', id: 'zoomIn' }]);
      expect(posted(first.panel, 'command')).toHaveLength(0);

      second.panel._fireViewState({ active: false, visible: true });
      expect(ReaderPanel.postToActive('find')).toBe(false);
    });

    it('returns false after the focused panel is closed', () => {
      const { panel } = open();
      panel._fireViewState({ active: true, visible: true });
      panel.dispose();
      expect(ReaderPanel.postToActive('zoomOut')).toBe(false);
    });
  });
});
