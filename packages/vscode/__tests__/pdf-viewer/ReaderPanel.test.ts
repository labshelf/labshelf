// Tests the panel kind a build preview uses: keybinding commands reach it, annotation writes show a notice, closing runs the source's hook.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReaderPanel } from '../../src/pdf-viewer/ReaderPanel';
import { createPreviewStore } from '../../src/writing/preview/previewStore';
import { statFromDisk } from '../support/diskStat';

const vscode = require('vscode');
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
    const showBuildProblem = jest.fn(async () => {});
    const reader = ReaderPanel.createOrShow(
      { extensionUri: vscode.Uri.file(extensionDir), logger, locatePdfjs: () => null, isMac: false },
      {
        key: 'preview:/p', store: createPreviewStore(), pdfUri: vscode.Uri.file('/p/main.pdf'), rootDir: vscode.Uri.file('/p'),
        paper: { id: 'preview:p', title: 'main.pdf', path: '/p', citeKey: '', status: 'reading' },
        preview: { showBuildProblem, showSource: jest.fn(async () => {}), lookupCitation: jest.fn(async () => []), openCitedPaper: jest.fn(async () => {}) },
        onClosed, show: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      },
    );
    const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
    return { panel, reader, onClosed, showBuildProblem };
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

  it('answers the reader banner click through the preview ports', async () => {
    const { panel, showBuildProblem } = open();
    panel.webview._fireMessage({ command: 'showBuildProblem' });
    await flush();
    expect(showBuildProblem).toHaveBeenCalledTimes(1);
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
