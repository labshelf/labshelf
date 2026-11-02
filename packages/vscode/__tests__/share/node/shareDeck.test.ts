/** Spec 10.3: Share Deck as Link saves the deck, shares it through the host and copies the link; Insert QR writes the svg and one WorkspaceEdit. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ShareHost } from '@labshelf/core';
import { runInsertQr, runShareDeck } from '../../../src/share/node/shareDeck';

const LINK = 'https://share.labshelf.app/s/#relay.someone.workers.dev/0123456789abcdef0123456789abcdef/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const DECK = [
  '<!doctype html>',
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1600x1000px">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <title>My talk</title>',
  '  <link rel="stylesheet" href="theme.css" data-deck-theme>',
  '</head>',
  '<body>',
  '  <section data-slide>',
  '    <div data-block="title" style="left: 120px; top: 80px; width: 1200px; height: 200px;"><h1>My talk</h1></div>',
  '  </section>',
  '  <section data-slide>',
  '    <div data-block="body" style="left: 120px; top: 320px; width: 800px; height: 400px;"><p>Body</p></div>',
  '  </section>',
  '</body>',
  '</html>',
  '',
].join('\n');

const QR_BLOCK = '<div data-block="share-qr" style="left: 1360px; top: 760px; width: 200px; height: 200px;"><img src="assets/share-qr.svg" alt="QR code of the share link"></div>';

type Pos = { line: number; character: number };

/** A text document over `text` with the position maths the extension may use. */
function textDocument(uri: vscode.Uri, text: string, isDirty: boolean) {
  const lines = text.split('\n');
  const offsetAt = (p: Pos): number => {
    let offset = 0;
    for (let i = 0; i < p.line && i < lines.length; i++) offset += lines[i]!.length + 1;
    return Math.min(offset + p.character, text.length);
  };
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset).split('\n');
    return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
  };
  return {
    uri,
    fileName: uri.fsPath,
    languageId: 'html',
    version: 1,
    isDirty,
    isClosed: false,
    isUntitled: false,
    eol: 1,
    lineCount: lines.length,
    getText: jest.fn(() => text),
    positionAt: jest.fn(positionAt),
    offsetAt: jest.fn(offsetAt),
    lineAt: jest.fn((line: number) => ({
      lineNumber: line,
      text: lines[line] ?? '',
      range: new vscode.Range(line, 0, line, (lines[line] ?? '').length),
      rangeIncludingLineBreak: new vscode.Range(line, 0, line + 1, 0),
    })),
    save: jest.fn(async () => true),
    _offsetAt: offsetAt,
  };
}

/** Applies the mock WorkspaceEdit's replacements to the document text. */
function applyReplacements(text: string, doc: ReturnType<typeof textDocument>, edit: { replacements: Array<{ range: { start: Pos; end: Pos }; text: string }> }): string {
  const ordered = edit.replacements
    .map((r) => ({ from: doc._offsetAt(r.range.start), to: doc._offsetAt(r.range.end), text: r.text }))
    .sort((a, b) => b.from - a.from);
  let result = text;
  for (const r of ordered) result = result.slice(0, r.from) + r.text + result.slice(r.to);
  return result;
}

/** The first action a message offers, string or MessageItem, so a modal notice proceeds. */
function firstAction(...args: unknown[]): unknown {
  return args.slice(1).find((arg) => typeof arg === 'string' || (typeof arg === 'object' && arg !== null && 'title' in arg && !(arg as { isCloseAffordance?: boolean }).isCloseAffordance));
}

const workspace = vscode.workspace as unknown as {
  textDocuments: unknown[];
  openTextDocument: jest.Mock;
  applyEdit: jest.Mock;
  fs: { writeFile: jest.Mock; createDirectory: jest.Mock };
};
const window = vscode.window as unknown as { showWarningMessage: jest.Mock; showInformationMessage: jest.Mock };

let dir: string;
let deckUri: vscode.Uri;

function openDeck(isDirty = false) {
  const doc = textDocument(deckUri, DECK, isDirty);
  workspace.textDocuments = [doc];
  workspace.openTextDocument.mockImplementation(async () => doc);
  return doc;
}

function fakeHost(result: { kind: 'shared'; link: string } | { kind: 'noRelay' }) {
  const shareDeck = jest.fn(async (_deckPath: string, onProgress: (progress: unknown) => void) => {
    onProgress({ stage: 'reading' });
    onProgress({ stage: 'encrypting' });
    onProgress({ stage: 'uploading' });
    return result;
  });
  const host = { place: 'this device', shareDeck, openLink: jest.fn(async () => undefined), copyText: jest.fn(async () => true) };
  return { shareDeck, host: host as unknown as ShareHost };
}

function fakeUi() {
  return {
    copyText: jest.fn(async (_text: string) => true),
    info: jest.fn(async (message: string, ...actions: string[]) => (message === 'Link copied.' ? undefined : actions[0])),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-share-deck-'));
  fs.writeFileSync(path.join(dir, 'deck.html'), DECK);
  deckUri = vscode.Uri.file(path.join(dir, 'deck.html'));
  workspace.applyEdit.mockReset().mockImplementation(async () => true);
  workspace.fs.writeFile.mockReset().mockImplementation(async () => undefined);
  workspace.fs.createDirectory.mockReset().mockImplementation(async () => undefined);
  window.showWarningMessage.mockReset().mockImplementation(async (...args: unknown[]) => firstAction(...args));
  window.showInformationMessage.mockReset().mockImplementation(async (...args: unknown[]) => firstAction(...args));
});

afterEach(() => {
  workspace.textDocuments = [];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('runShareDeck', () => {
  it('10.3b shares the deck through host.shareDeck with the deck path and returns the link', async () => {
    openDeck();
    const { host, shareDeck } = fakeHost({ kind: 'shared', link: LINK });
    const result = await runShareDeck(deckUri, host, fakeUi());
    expect(result).toBe(LINK);
    expect(shareDeck).toHaveBeenCalledTimes(1);
    expect(shareDeck.mock.calls[0]![0]).toBe(deckUri.fsPath);
    expect(typeof shareDeck.mock.calls[0]![1]).toBe('function');
  });

  it('10.3b saves a dirty deck before sharing it', async () => {
    const doc = openDeck(true);
    const { host, shareDeck } = fakeHost({ kind: 'shared', link: LINK });
    await runShareDeck(deckUri, host, fakeUi());
    expect(doc.save).toHaveBeenCalled();
    expect(doc.save.mock.invocationCallOrder[0]!).toBeLessThan(shareDeck.mock.invocationCallOrder[0]!);
  });

  it('10.3b does not save a deck that has no unsaved changes', async () => {
    const doc = openDeck(false);
    const { host } = fakeHost({ kind: 'shared', link: LINK });
    await runShareDeck(deckUri, host, fakeUi());
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('10.3b copies the link and says Link copied. with Open Link and Insert QR Code', async () => {
    openDeck();
    const { host } = fakeHost({ kind: 'shared', link: LINK });
    const ui = fakeUi();
    await runShareDeck(deckUri, host, ui);
    expect(ui.copyText).toHaveBeenCalledWith(LINK);
    expect(ui.info).toHaveBeenCalledWith('Link copied.', 'Open Link', 'Insert QR Code');
  });

  it('10.3b gives undefined and copies nothing when no relay is connected', async () => {
    openDeck();
    const { host } = fakeHost({ kind: 'noRelay' });
    const ui = fakeUi();
    expect(await runShareDeck(deckUri, host, ui)).toBeUndefined();
    expect(ui.copyText).not.toHaveBeenCalled();
    expect(ui.info).not.toHaveBeenCalledWith('Link copied.', expect.anything(), expect.anything());
  });
});

describe('runInsertQr', () => {
  it('10.3c writes assets/share-qr.svg next to the deck', async () => {
    openDeck();
    expect(await runInsertQr(deckUri, LINK, 0)).toBe(true);
    const svgPath = path.join(dir, 'assets', 'share-qr.svg');
    const write = workspace.fs.writeFile.mock.calls.find(([uri]) => (uri as vscode.Uri).fsPath === svgPath);
    expect(write).toBeDefined();
    expect(Buffer.from(write![1] as Uint8Array).toString('utf8')).toContain('<svg');
  });

  it('10.3c applies one WorkspaceEdit on the deck that adds the share-qr image block', async () => {
    const doc = openDeck();
    await runInsertQr(deckUri, LINK, 0);
    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const edit = workspace.applyEdit.mock.calls[0]![0] as { replacements: Array<{ uri: vscode.Uri; range: { start: Pos; end: Pos }; text: string }> };
    expect(edit.replacements.length).toBeGreaterThan(0);
    for (const r of edit.replacements) expect(r.uri.fsPath).toBe(deckUri.fsPath);
    const after = applyReplacements(DECK, doc, edit);
    expect(after.split(QR_BLOCK).length - 1).toBe(1);
    // The block lands in the first slide.
    const firstSlideEnd = after.indexOf('</section>');
    expect(after.indexOf(QR_BLOCK)).toBeLessThan(firstSlideEnd);
  });

  it('10.3c inserts into the slide it is given', async () => {
    const doc = openDeck();
    await runInsertQr(deckUri, LINK, 1);
    const edit = workspace.applyEdit.mock.calls[0]![0] as { replacements: Array<{ range: { start: Pos; end: Pos }; text: string }> };
    const after = applyReplacements(DECK, doc, edit);
    const at = after.indexOf(QR_BLOCK);
    expect(at).toBeGreaterThan(after.indexOf('</section>'));
    expect(at).toBeLessThan(after.lastIndexOf('</section>'));
  });
});
