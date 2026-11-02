// Deck editor document sync: each page gesture becomes one WorkspaceEdit over deck.html and theme.css, its echo is swallowed and any other change of either file goes back to the page as an update.
import * as vscode from "vscode";

import type { DeckHostMessage } from "./deckMessages.js";

export interface DeckSync { applyFromPage(message: { deck: string; theme?: string; baseVersion: number }): Promise<boolean>; dispose(): void }

/** The single replace that turns before into after: the longest common prefix, then the longest common suffix not overlapping it, in before's UTF-16 offsets; null when equal. */
export function minimalReplace(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < shorter - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}

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

export function createDeckSync(deck: vscode.TextDocument, themeUri: vscode.Uri, post: (message: DeckHostMessage) => void): DeckSync {
  let disposed = false;
  /** The texts the sync's last edit leaves, per file; the matching change event is its echo. */
  const expected = new Map<string, string>();
  /** After the sync's own deck edit the page keeps its base version while the document moved on: docVersion stands for pageVersion. */
  let alias: { docVersion: number; pageVersion: number } | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };

  const postUpdate = (): Promise<void> => enqueue(async () => {
    const theme = await readThemeText(themeUri);
    if (disposed) return;
    alias = undefined;
    post({ type: "update", deck: deck.getText(), theme, version: deck.version });
  });

  const isEcho = (uri: vscode.Uri, text: string): boolean => {
    const key = uri.toString();
    const wanted = expected.get(key);
    expected.delete(key);
    return wanted === text;
  };

  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (disposed || event.contentChanges.length === 0) return;
    const { uri } = event.document;
    if (!sameUri(uri, deck.uri) && !sameUri(uri, themeUri)) return;
    if (isEcho(uri, event.document.getText())) return;
    void postUpdate();
  });

  const isCurrent = (baseVersion: number): boolean =>
    baseVersion === deck.version || (alias !== undefined && alias.pageVersion === baseVersion && alias.docVersion === deck.version);

  const apply = async (message: { deck: string; theme?: string; baseVersion: number }): Promise<boolean> => {
    if (!isCurrent(message.baseVersion)) {
      const theme = await readThemeText(themeUri);
      if (!disposed) { alias = undefined; post({ type: "update", deck: deck.getText(), theme, version: deck.version }); }
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    const deckChanged = addReplace(edit, deck, message.deck);
    let themeChanged = false;
    if (message.theme !== undefined) {
      const themeDocument = await openTheme(themeUri);
      if (themeDocument) {
        themeChanged = addReplace(edit, themeDocument, message.theme);
      } else if (message.theme !== "") {
        edit.createFile(themeUri, { ignoreIfExists: true });
        edit.insert(themeUri, new vscode.Position(0, 0), message.theme);
        themeChanged = true;
      }
    }
    if (!deckChanged && !themeChanged) return true;
    if (deckChanged) expected.set(deck.uri.toString(), message.deck);
    if (themeChanged) expected.set(themeUri.toString(), message.theme!);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      expected.clear();
      return false;
    }
    if (deckChanged) alias = { docVersion: deck.version, pageVersion: message.baseVersion };
    if (!disposed) post({ type: "dirty", dirty: true });
    return true;
  };

  return {
    applyFromPage: (message) => enqueue(() => apply(message)),
    dispose(): void {
      disposed = true;
      listener.dispose();
      expected.clear();
    },
  };
}
