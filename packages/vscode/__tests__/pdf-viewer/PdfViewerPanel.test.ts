import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PdfViewerPanel, type PdfViewerDeps } from '../../src/pdf-viewer/PdfViewerPanel';
import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { makeMemoryPaperDataStore } from '../support/memorySidecarPort';
import { EventBus, EVENTS } from '../../src/events/index.js';

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
    extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-panel-'));
    fs.mkdirSync(path.join(extensionDir, 'dist', 'reader'), { recursive: true });
    fs.writeFileSync(path.join(extensionDir, 'dist', 'reader', 'reader.js'), '// bundle');
  });
  afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });

  beforeEach(() => {
    PdfViewerPanel._clearAllForTesting();
    jest.clearAllMocks();
    vscode.window.activeColorTheme = { kind: 2 };
    for (const key of Object.keys(vscode.workspace._config)) { delete vscode.workspace._config[key]; }
  });

  function makeDeps(overrides: Partial<PdfViewerDeps> = {}) {
    const store = makeMemoryPaperDataStore();
    const eventBus = new EventBus();
    const themeManager = new ThemeManager();
    const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as any;
    const onReadingEvent = jest.fn();
    const deps: PdfViewerDeps = {
      extensionUri: vscode.Uri.file(extensionDir),
      eventBus,
      themeManager,
      store,
      logger,
      onReadingEvent,
      ...overrides,
    };
    return { deps, store, eventBus, themeManager, logger, onReadingEvent };
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

    it('assigns the HTML shell synchronously, before any disk access', () => {
      const ctx = makeDeps();
      jest.spyOn(ctx.store, 'load').mockImplementation(() => new Promise(() => {}));
      PdfViewerPanel.createOrShow(ctx.deps, makePaper());
      const html: string = lastPanel().webview.html;
      expect(html).toContain('data-pdf-theme="dark"');
      expect(html).toContain(path.join('dist', 'reader', 'reader.js'));
    });

    it('emits PDF_VIEWER_CLOSED with the last page once when the panel closes', async () => {
      const ctx = makeDeps();
      const closed = jest.fn();
      ctx.eventBus.on(EVENTS.PDF_VIEWER_CLOSED, closed);
      const paper = makePaper();
      PdfViewerPanel.createOrShow(ctx.deps, paper);
      lastPanel().webview._fireMessage({ command: 'pageChanged', pageNumber: 5 });
      await flush();
      lastPanel().dispose();
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ paperId: paper.id, currentPage: 5 }));
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

    it('emits annotation events on the event bus for the list and sync', async () => {
      const { panel, eventBus, store, paper } = open();
      const created = jest.fn();
      const deleted = jest.fn();
      eventBus.on(EVENTS.ANNOTATION_CREATED, created);
      eventBus.on(EVENTS.ANNOTATION_DELETED, deleted);
      panel.webview._fireMessage({ command: 'createAnnotation', type: 'note', pageNumber: 2, content: 'a note' });
      await flush();
      await flush();
      const [stored] = await store.getAnnotations(paper.id);
      expect(created).toHaveBeenCalledWith(stored);
      panel.webview._fireMessage({ command: 'deleteAnnotation', id: stored!.id });
      await flush();
      await flush();
      expect(deleted).toHaveBeenCalledWith({ annotationId: stored!.id, paperId: paper.id });
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
      expect(PdfViewerPanel.postToActive('zoomIn')).toBe(true);
      expect(posted(second.panel, 'command')).toEqual([{ type: 'command', id: 'zoomIn' }]);
      expect(posted(first.panel, 'command')).toHaveLength(0);

      second.panel._fireViewState({ active: false, visible: true });
      expect(PdfViewerPanel.postToActive('find')).toBe(false);
    });

    it('returns false after the focused panel is closed', () => {
      const { panel } = open();
      panel._fireViewState({ active: true, visible: true });
      panel.dispose();
      expect(PdfViewerPanel.postToActive('zoomOut')).toBe(false);
    });
  });

  describe('reading events', () => {
    afterEach(() => { jest.useRealTimers(); });

    it('records open, page dwell of at least five seconds, annotate and close', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { panel, onReadingEvent, paper } = open();

      panel.webview._fireMessage({ command: 'ready', totalPages: 9 });
      await flush();
      jest.setSystemTime(new Date('2026-01-01T00:00:02Z'));
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 2 }); // 2 s on page 1: skimmed
      await flush();
      jest.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 3 }); // 8 s on page 2: read
      await flush();
      panel.webview._fireMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 3, content: 'x', color: 'red' });
      await flush();
      await flush();
      panel.dispose();

      const events = onReadingEvent.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.kind)).toEqual(['open', 'scroll', 'annotate', 'close']);
      expect(events[1]).toMatchObject({ paperId: paper.id, page: 2, durationMs: 8000 });
      expect(events[3]).toMatchObject({ kind: 'close', page: 3 });
    });

    it('survives a throwing analytics sink', async () => {
      const { panel } = open({ onReadingEvent: () => { throw new Error('db closed'); } });
      panel.webview._fireMessage({ command: 'ready', totalPages: 1 });
      await flush();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });
});
