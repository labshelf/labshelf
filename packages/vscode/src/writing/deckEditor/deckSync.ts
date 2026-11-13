// Deck editor document sync: each page gesture becomes one WorkspaceEdit over deck.html and theme.css, its echo is swallowed and any other change of either file goes back to the page as an update.
import * as vscode from "vscode";

import { createAutosave, minimalReplace } from "../../localSync/index.js";
import type { DeckHostMessage } from "./deckMessages.js";

export interface DeckSync { applyFromPage(message: { deck: string; theme?: string; baseVersion: number }): Promise<boolean>; dispose(): void }

/** The theme document, or undefined when theme.css does not exist. */
async function openTheme(themeUri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(themeUri);
  } catch {
    return undefined;
  }
}

/** The text of theme.css, or "" when it is missing. */
export async function readThemeText(themeUri: vscode.Uri): Promise<string> {
  return (await openTheme(themeUri))?.getText() ?? "";
}

/** Adds the minimal replace of document into the edit; false when the text is unchanged. */
function addReplace(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, after: string): boolean {
  const replace = minimalReplace(document.getText(), after);
  if (!replace) return false;
  edit.replace(document.uri, new vscode.Range(document.positionAt(replace.from), document.positionAt(replace.to)), replace.insert);
  return true;
}

const sameUri = (a: vscode.Uri, b: vscode.Uri): boolean => a.toString() === b.toString();

/** Adds the theme change into the edit, creating theme.css when it is missing and the new text is not empty; false when nothing changes. */
async function addThemeEdit(edit: vscode.WorkspaceEdit, themeUri: vscode.Uri, theme: string): Promise<boolean> {
  const themeDocument = await openTheme(themeUri);
  if (themeDocument) return addReplace(edit, themeDocument, theme);
  if (theme === "") return false;
  edit.createFile(themeUri, { ignoreIfExists: true });
  edit.insert(themeUri, new vscode.Position(0, 0), theme);
  return true;
}

/** Runs the work one after another; a failed run rejects its caller but does not stop the ones after it. */
function createQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
}

/** The texts the sync's last edit leaves, per file; the matching change event is its echo. */
function createEchoTracker(): { expect(uri: vscode.Uri, text: string): void; isEcho(uri: vscode.Uri, text: string): boolean; clear(): void } {
  const expected = new Map<string, string>();
  return {
    expect: (uri, text) => { expected.set(uri.toString(), text); },
    isEcho(uri, text) {
      const key = uri.toString();
      const wanted = expected.get(key);
      expected.delete(key);
      return wanted === text;
    },
    clear: () => expected.clear(),
  };
}

/** The one WorkspaceEdit that turns deck.html and theme.css into the page's texts, and which of the two it changes. */
async function buildPageEdit(
  deck: vscode.TextDocument, themeUri: vscode.Uri, message: { deck: string; theme?: string },
): Promise<{ edit: vscode.WorkspaceEdit; deckChanged: boolean; themeChanged: boolean }> {
  const edit = new vscode.WorkspaceEdit();
  const deckChanged = addReplace(edit, deck, message.deck);
  const themeChanged = message.theme !== undefined && await addThemeEdit(edit, themeUri, message.theme);
  return { edit, deckChanged, themeChanged };
}

/** Calls onChange for every change of one of the files that is not the echo of the sync's own edit. */
function onOutsideChange(uris: readonly vscode.Uri[], echoes: ReturnType<typeof createEchoTracker>, onChange: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length === 0) return;
    const { uri } = event.document;
    if (!uris.some((watched) => sameUri(uri, watched))) return;
    if (echoes.isEcho(uri, event.document.getText())) return;
    onChange();
  });
}

export function createDeckSync(deck: vscode.TextDocument, themeUri: vscode.Uri, post: (message: DeckHostMessage) => void): DeckSync {
  let disposed = false;
  const echoes = createEchoTracker();
  /** After the sync's own deck edit the page keeps its base version while the document moved on: docVersion stands for pageVersion. */
  let alias: { docVersion: number; pageVersion: number } | undefined;
  const enqueue = createQueue();
  // A page edit is saved 300 ms after the last one: deck.html, and theme.css when the edit touched it, each only if still dirty.
  const autosave = createAutosave();
  const sendUpdate = async (): Promise<void> => {
    const theme = await readThemeText(themeUri);
    if (disposed) return;
    alias = undefined;
    post({ type: "update", deck: deck.getText(), theme, version: deck.version });
  };

  const listener = onOutsideChange([deck.uri, themeUri], echoes, () => { if (!disposed) void enqueue(sendUpdate); });

  const isCurrent = (baseVersion: number): boolean =>
    baseVersion === deck.version || (alias !== undefined && alias.pageVersion === baseVersion && alias.docVersion === deck.version);

  const apply = async (message: { deck: string; theme?: string; baseVersion: number }): Promise<boolean> => {
    if (!isCurrent(message.baseVersion)) {
      await sendUpdate();
      return false;
    }
    const { edit, deckChanged, themeChanged } = await buildPageEdit(deck, themeUri, message);
    if (!deckChanged && !themeChanged) return true;
    if (deckChanged) echoes.expect(deck.uri, message.deck);
    if (themeChanged) echoes.expect(themeUri, message.theme!);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) { echoes.clear(); return false; }
    if (deckChanged) alias = { docVersion: deck.version, pageVersion: message.baseVersion };
    if (!disposed) {
      post({ type: "dirty", dirty: true });
      if (deckChanged) autosave.schedule(deck);
      if (themeChanged) void openTheme(themeUri).then((theme) => { if (theme && !disposed) autosave.schedule(theme); });
    }
    return true;
  };

  return {
    applyFromPage: (message) => enqueue(() => apply(message)),
    dispose(): void {
      disposed = true;
      autosave.dispose();
      listener.dispose();
      echoes.clear();
    },
  };
}
