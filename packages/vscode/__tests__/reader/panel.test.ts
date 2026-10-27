// Tests the reader panel: build-preview panels, VS Code host ports and the PDF reader panel opener.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPreviewStore, exportAnnotations } from '@labshelf/core';
import {
  createSidecarChangeSender, createVsCodeExportPorts, createVsCodeOutputPorts, PdfReaderPanel, ReaderPanel, showNoticeInVsCode,
  type PdfReaderDeps,
} from '../../src/reader/panel';
import { createLibraryEvents } from '../../src/library/index.js';
import { statFromDisk } from '../support/diskStat';
import { makeMemoryPaperDataStore } from '../support/memorySidecarPort';

const vscode = require('vscode');

describe('ReaderPanel.test', () => {
  // Tests the panel kind a build preview uses: keybinding commands reach it, annotation writes show a notice, closing runs the source's hook.
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  describe('ReaderPanel as a build preview', () => {
    let extensionDir: string;
    beforeAll(() => {
      statFromDisk();
      extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-reader-panel-'));
      fs.mkdirSync(path.join(extensionDir, 'dist', 'reader'), { recursive: true });
      fs.writeFileSync(path.join(extensionDir, 'dist', 'reader', 'reader.js'), '// bundle');
    });
    afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });
    beforeEach(() => { ReaderPanel._clearAllForTesting(); jest.clearAllMocks(); });

    function open(onClosed = jest.fn()) {
      const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as any;
      const showSource = jest.fn(async () => {});
      const reader = ReaderPanel.createOrShow(
        { extensionUri: vscode.Uri.file(extensionDir), logger, locatePdfjs: () => null, isMac: false },
        {
          key: 'preview:/p', store: createPreviewStore(), pdfUri: vscode.Uri.file('/p/main.pdf'), rootDir: vscode.Uri.file('/p'),
          paper: { id: 'preview:p', title: 'main.pdf', path: '/p', citeKey: '', status: 'reading' },
          preview: { showSource, lookupCitation: jest.fn(async () => []), openCitedPaper: jest.fn(async () => {}),
            recompile: jest.fn(async () => {}), revealCursor: jest.fn(async () => {}), openProblem: jest.fn(async () => {}), openRawLog: jest.fn(async () => {}) },
          onClosed, show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        },
      );
      const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
      return { panel, reader, onClosed, showSource };
    }

    it('opens beside without taking focus and receives reader keybinding commands', () => {
      const { panel } = open();
      expect((vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[2]).toEqual({ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
      panel._fireViewState({ active: true, visible: true });
      expect(ReaderPanel.postToActive('zoomIn')).toBe(true);
      expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'command', id: 'zoomIn' });
    });

    it('reveals an open preview in its column without taking focus', () => {
      const { panel } = open();
      open();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(panel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('answers a reader double-click through the preview ports', async () => {
      const { panel, showSource } = open();
      const point = { page: 2, x: 10, y: 20 };
      panel.webview._fireMessage({ command: 'showSource', point });
      await flush();
      expect(showSource).toHaveBeenCalledWith(point);
    });

    it('shows a notice instead of saving an annotation', async () => {
      const { panel } = open();
      panel.webview._fireMessage({ command: 'createAnnotation', type: 'note', pageNumber: 1, content: 'x' });
      await flush();
      await flush();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Annotations are not saved in a build preview.'));
    });

    it('shows another PDF in the same panel under a new title', async () => {
      const { panel, reader } = open();
      reader.controller.handle({ command: 'ready', totalPages: 1 });
      await flush();
      reader.showDocument(vscode.Uri.file('/p/other.pdf'), 'other.pdf');
      expect(panel.title).toBe('other.pdf');
      expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'reloadDocument', pdfUrl: expect.stringContaining('other.pdf') });
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });

    it('runs the close hook once', () => {
      const { panel, onClosed } = open();
      panel.dispose();
      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('closes out when the host disposes it, so the next open creates a fresh panel', () => {
      const { reader, onClosed } = open();
      reader.dispose();
      expect(onClosed).toHaveBeenCalledTimes(1);
      open();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });
});

describe('readerHostPorts.test', () => {
  // Tests VS Code reader host port implementations.
  const paper = { id: 'p1', title: 'Test Paper', path: '/papers/p1', citeKey: 'test2026', authors: ['Ana Silva'], year: 2026, status: 'unread' } as any;

  describe('VS Code reader host ports', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    describe('showNoticeInVsCode', () => {
      it('shows confirmations in the status bar', () => {
        showNoticeInVsCode('Copied to clipboard', 'ok');
        expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Copied to clipboard', 2500);
      });

      it('prefixes errors with LabShelf', () => {
        showNoticeInVsCode('Reader action failed: boom', 'error');
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('LabShelf: Reader action failed: boom');
      });

      it('shows other notices as information messages', () => {
        showNoticeInVsCode('Heads up', 'info');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Heads up');
      });
    });

    it('writes the clipboard and opens external links through vscode.env', async () => {
      const ports = createVsCodeOutputPorts(paper);
      await ports.writeClipboard('text');
      await ports.openExternal('https://doi.org/10.1/x');
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('text');
      expect(vscode.env.openExternal.mock.calls[0][0].toString()).toContain('doi.org/10.1/x');
    });

    describe('saveAnnotations', () => {
      it('writes to the file chosen in the save dialog, defaulting to the paper folder, and opens it beside', async () => {
        const target = vscode.Uri.file('/tmp/out/annotations.md');
        (vscode.window.showSaveDialog as jest.Mock).mockResolvedValueOnce(target);
        await createVsCodeOutputPorts(paper).saveAnnotations('# Notes');
        const dialogOptions = (vscode.window.showSaveDialog as jest.Mock).mock.calls[0][0];
        expect(dialogOptions.defaultUri.fsPath).toBe(path.join(paper.path, 'annotations.md'));
        expect(new TextDecoder().decode(vscode.workspace.fs.writeFile.mock.calls[0][1])).toBe('# Notes');
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith(target, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      });

      it('writes nothing when the save dialog is cancelled', async () => {
        await createVsCodeOutputPorts(paper).saveAnnotations('# Notes');
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
      });
    });

    it('gives the palette export command the same clipboard export as the reader', async () => {
      const store = makeMemoryPaperDataStore();
      await store.addHighlight(paper.id, 3, 'key finding', 'blue');
      await exportAnnotations(createVsCodeExportPorts(paper, store), 'clipboard');
      const markdown = (vscode.env.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
      expect(markdown).toContain('## Page 3');
      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Annotations copied as Markdown', 2500);
    });

    describe('createSidecarChangeSender', () => {
      const annotation = { id: 'a1', paperId: 'p1' } as any;

      it('republishes annotation changes as annotationChanged and ignores theme changes', () => {
        const bus = createLibraryEvents();
        const seen: unknown[] = [];
        bus.annotationChanged.event((payload) => { seen.push(payload); });
        const emit = createSidecarChangeSender(bus, 'p1');
        emit({ kind: 'annotationCreated', annotation });
        emit({ kind: 'annotationUpdated', annotation });
        emit({ kind: 'annotationDeleted', annotationId: 'a1' });
        emit({ kind: 'theme' });
        expect(seen).toEqual([{ paperId: 'p1' }, { paperId: 'p1' }, { paperId: 'p1' }]);
      });
    });
  });
});

describe('readerPaperOpener.test', () => {
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

  describe('PdfReaderPanel', () => {
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

    function makeDeps(overrides: Partial<PdfReaderDeps> = {}) {
      const store = makeMemoryPaperDataStore();
      const events = createLibraryEvents();
      const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as any;
      const deps: PdfReaderDeps = {
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

    function open(overrides: Partial<PdfReaderDeps> = {}, paperOverrides: Record<string, unknown> = {}) {
      const ctx = makeDeps(overrides);
      const paper = makePaper(paperOverrides);
      PdfReaderPanel.createOrShow(ctx.deps, paper);
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
        PdfReaderPanel.createOrShow(ctx.deps, makePaper());
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
        PdfReaderPanel.createOrShow(ctx.deps, paper);
        lastPanel().dispose();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(closed).toHaveBeenCalledWith(expect.objectContaining({ paperId: paper.id }));
      });

      it('reveals the existing ready panel and scrolls it to a requested page', async () => {
        const { deps, paper, panel } = open();
        panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
        await flush();
        const created = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.length;
        PdfReaderPanel.createOrShow(deps, paper, { page: 7 });
        expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(created);
        expect(panel.reveal).toHaveBeenCalled();
        expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 7 }]);
      });

      it('holds a page asked for by a reveal before the reader is ready, and scrolls there once it is', async () => {
        const { deps, paper, panel } = open();
        PdfReaderPanel.createOrShow(deps, paper, { page: 7 });
        expect(posted(panel, 'scrollToPage')).toHaveLength(0);
        panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
        await flush();
        expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 7 }]);
      });

      it('delivers a page requested at open time once the webview is ready', async () => {
        const ctx = makeDeps();
        PdfReaderPanel.createOrShow(ctx.deps, makePaper(), { page: 4 });
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
});
