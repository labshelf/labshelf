// The VS Code note file io (plan charts, D4/D5): files beside a note through the library file system, and the host's file pick.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { answerNoteFileRequest, noteFilesPortFor, type NoteFileRequest } from '@labshelf/core';
import { createVsCodeNoteFileIo } from '../../src/reader/noteFiles';
import { answerListMessage } from '../../src/libraryUi/handlers';
import type { ListHostContext } from '../../src/libraryUi/handlers';
import { MemoryLibraryFs } from '../support/memoryLibraryFs';

const FOLDER = '/lib/papers/p1';
const CSV = new TextEncoder().encode('a,b\n1,2\n');
const showOpenDialog = vscode.window.showOpenDialog as jest.Mock;
const readFile = vscode.workspace.fs.readFile as jest.Mock;

function setup() {
  const fs = new MemoryLibraryFs();
  const io = createVsCodeNoteFileIo(fs, path.posix.join);
  return { fs, io, port: noteFilesPortFor(io, FOLDER) };
}

const pickRequest = (requestId = 'r1'): NoteFileRequest => ({ type: 'noteFile.pick', requestId, accept: ['.csv', '.tsv'] });

describe('createVsCodeNoteFileIo files', () => {
  it('4.4a writes papers/p1/assets/c.csv through the fs and reads the same bytes back', async () => {
    const { fs, port } = setup();
    await port.write('assets/c.csv', CSV);
    expect(fs.files.get('/lib/papers/p1/assets/c.csv')).toEqual(CSV);
    expect(await port.read('assets/c.csv')).toEqual(CSV);
  });

  it('4.4a answers a missing file with null', async () => {
    const { port } = setup();
    expect(await port.read('assets/missing.csv')).toBeNull();
  });

  it('4.4a answers a write request then a read request with the same bytes as base64', async () => {
    const { io } = setup();
    const base64 = Buffer.from(CSV).toString('base64');
    expect(await answerNoteFileRequest(io, FOLDER, { type: 'noteFile.write', requestId: 'w1', path: 'assets/c.csv', base64 }))
      .toEqual({ type: 'noteFile.reply', requestId: 'w1' });
    expect(await answerNoteFileRequest(io, FOLDER, { type: 'noteFile.read', requestId: 'r1', path: 'assets/c.csv' }))
      .toEqual({ type: 'noteFile.reply', requestId: 'r1', base64 });
  });
});

describe('createVsCodeNoteFileIo pick', () => {
  beforeEach(() => { showOpenDialog.mockReset(); readFile.mockReset(); });

  it('4.4a answers a cancelled dialog with null', async () => {
    const { io } = setup();
    showOpenDialog.mockResolvedValueOnce(undefined);
    expect(await io.pick(['.csv'])).toBeNull();
  });

  it('4.4a answers an empty selection with null', async () => {
    const { io } = setup();
    showOpenDialog.mockResolvedValueOnce([]);
    expect(await io.pick(['.csv'])).toBeNull();
  });

  it('4.4a returns the picked file basename and its UTF-8 text', async () => {
    const { io } = setup();
    showOpenDialog.mockResolvedValueOnce([vscode.Uri.file('/home/me/data/müller.csv')]);
    readFile.mockResolvedValueOnce(new TextEncoder().encode('é,b\n1,2\n'));
    expect(await io.pick(['.csv', '.tsv'])).toEqual({ name: 'müller.csv', text: 'é,b\n1,2\n' });
  });

  it('4.4a opens a single-selection dialog filtered by the accepted extensions without dots', async () => {
    const { io } = setup();
    showOpenDialog.mockResolvedValueOnce(undefined);
    await io.pick(['.csv', '.tsv']);
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      canSelectMany: false,
      filters: { Data: ['csv', 'tsv'] },
      openLabel: 'Import',
    }));
  });

  it('4.4a answers a pick request with the file, and a cancelled one with null', async () => {
    const { io } = setup();
    showOpenDialog.mockResolvedValueOnce([vscode.Uri.file('/x/d.csv')]);
    readFile.mockResolvedValueOnce(new TextEncoder().encode('1,2'));
    expect(await answerNoteFileRequest(io, FOLDER, pickRequest('p1')))
      .toEqual({ type: 'noteFile.reply', requestId: 'p1', file: { name: 'd.csv', text: '1,2' } });
    showOpenDialog.mockResolvedValueOnce(undefined);
    expect(await answerNoteFileRequest(io, FOLDER, pickRequest('p2')))
      .toEqual({ type: 'noteFile.reply', requestId: 'p2', file: null });
  });
});

describe('library pane paper.noteFile', () => {
  beforeEach(() => { showOpenDialog.mockReset(); readFile.mockReset(); });

  function context() {
    const post = jest.fn(async () => undefined);
    const ctx = {
      deps: { pathOps: path, logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } },
      paths: () => ({ root: '/lib/papers' }),
      papers: async () => [{ id: 'p1', title: 'T', path: FOLDER }],
      post,
      notice: jest.fn(),
    } as unknown as ListHostContext;
    return { ctx, post };
  }

  it('4.4a posts a noteFile.reply with the same requestId for a pick', async () => {
    const { ctx, post } = context();
    showOpenDialog.mockResolvedValueOnce([vscode.Uri.file('/x/d.csv')]);
    readFile.mockResolvedValueOnce(new TextEncoder().encode('1,2'));

    await answerListMessage(ctx, { type: 'paper.noteFile', id: 'p1', request: pickRequest('req-7') });

    expect(post).toHaveBeenCalledWith({ type: 'noteFile.reply', requestId: 'req-7', file: { name: 'd.csv', text: '1,2' } });
  });

  it('4.4a posts the cancelled pick as file null with the same requestId', async () => {
    const { ctx, post } = context();
    showOpenDialog.mockResolvedValueOnce(undefined);

    await answerListMessage(ctx, { type: 'paper.noteFile', id: 'p1', request: pickRequest('req-8') });

    expect(post).toHaveBeenCalledWith({ type: 'noteFile.reply', requestId: 'req-8', file: null });
  });
});
