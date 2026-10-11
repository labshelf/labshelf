import * as path from 'node:path';
import { exportAnnotations } from '@labshelf/core';
import { createVsCodeExportPorts, createVsCodeOutputPorts, emitSidecarChanges, notifyInVsCode } from '../../src/pdf-viewer/readerHostPorts';
import { makeMemoryPaperDataStore } from '../support/memorySidecarPort';
import { EventBus, EVENTS } from '../../src/events/index.js';

const vscode = require('vscode');

const paper = { id: 'p1', title: 'Test Paper', path: '/papers/p1', citeKey: 'test2026', authors: ['Ana Silva'], year: 2026, status: 'unread' } as any;

describe('VS Code reader host ports', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('notifyInVsCode', () => {
    it('shows confirmations in the status bar', () => {
      notifyInVsCode('Copied to clipboard', 'ok');
      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Copied to clipboard', 2500);
    });

    it('prefixes errors with LabShelf', () => {
      notifyInVsCode('Reader action failed: boom', 'error');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('LabShelf: Reader action failed: boom');
    });

    it('shows other notices as information messages', () => {
      notifyInVsCode('Heads up', 'info');
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

  describe('emitSidecarChanges', () => {
    const annotation = { id: 'a1', paperId: 'p1' } as any;

    it('republishes annotation changes on the event bus and ignores theme changes', () => {
      const bus = new EventBus();
      const seen: Array<[string, unknown]> = [];
      for (const name of [EVENTS.ANNOTATION_CREATED, EVENTS.ANNOTATION_UPDATED, EVENTS.ANNOTATION_DELETED]) {
        bus.on(name, (payload) => { seen.push([name, payload]); });
      }
      const emit = emitSidecarChanges(bus, 'p1');
      emit({ kind: 'annotationCreated', annotation });
      emit({ kind: 'annotationUpdated', annotation });
      emit({ kind: 'annotationDeleted', annotationId: 'a1' });
      emit({ kind: 'theme' });
      expect(seen).toEqual([
        [EVENTS.ANNOTATION_CREATED, annotation],
        [EVENTS.ANNOTATION_UPDATED, annotation],
        [EVENTS.ANNOTATION_DELETED, { annotationId: 'a1', paperId: 'p1' }],
      ]);
    });
  });
});
