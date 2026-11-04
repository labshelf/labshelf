// Registers the LabShelf deck editor, a custom editor for a talk's or poster's HTML file, which a deck HTML file opened as text reopens in;
// and the `labshelf.activeDeckKind` context key, the active file's kind read from its content, that the Present, Poster Preview and Reopen menus test.
import * as vscode from "vscode";

import { registerDeckCommands, type DeckCommandDeps } from "./commands.js";
import { isDeckFileCandidate, readDeckFileKind, type DeckKind, type ILogger } from "@labshelf/core";
import { reopenWith } from "../customEditorTabs.js";
import { readDeckText } from "./presenter.js";
import { createDeckEditorProvider, type DeckEditorProviderDeps } from "./provider.js";

export type { DeckEditorProviderDeps } from "./provider.js";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";

const CONTEXT_KEY = "labshelf.activeDeckKind";

/** The file of the active tab and whether a custom editor (the LabShelf source or deck editor) shows it rather than the text editor. */
function activeTab(): { uri: vscode.Uri; custom: boolean } | undefined {
  const input: unknown = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!input || typeof input !== "object" || !("uri" in input) || !(input.uri instanceof vscode.Uri)) return undefined;
  return { uri: input.uri, custom: "viewType" in input };
}

const activeTabUri = (): vscode.Uri | undefined => activeTab()?.uri;

async function readKind(uri: vscode.Uri | undefined): Promise<DeckKind | undefined> {
  if (uri?.scheme !== "file" || !isDeckFileCandidate(uri.path)) return undefined;
  const text = await readDeckText(uri);
  return text === undefined ? undefined : readDeckFileKind(uri.path, text);
}

/**
 * Keeps `labshelf.activeDeckKind` on the active file's kind ("talk", "poster" or "") and opens a deck HTML file that came up in the text
 * editor in the deck editor instead, unless the user reopened that file as text.
 */
function followActiveDeck(context: vscode.ExtensionContext, deckEditorViewType: string, logger: ILogger | undefined): { keepAsText(uri: vscode.Uri): void; release(uri: vscode.Uri): void } {
  const keptAsText = new Set<string>();
  // Each update bumps it, so a slow read that finishes after the active tab changed does not overwrite the newer answer.
  let generation = 0;
  const update = async (): Promise<void> => {
    const mine = ++generation;
    const tab = activeTab();
    const kind = await readKind(tab?.uri);
    if (mine !== generation) return;
    await vscode.commands.executeCommand("setContext", CONTEXT_KEY, kind ?? "");
    if (kind && tab && !tab.custom && /\.html$/i.test(tab.uri.path) && !keptAsText.has(tab.uri.toString())) {
      await reopenWith(deckEditorViewType, tab.uri);
    }
  };
  const schedule = (): void => { void update().catch((error: unknown) => logger?.error("writing/deckEditor", error, { action: "followActiveDeck" })); };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(schedule),
    vscode.window.tabGroups.onDidChangeTabGroups(schedule),
    vscode.workspace.onDidSaveTextDocument((document) => { if (document.uri.toString() === activeTabUri()?.toString()) schedule(); }),
  );
  schedule();
  return { keepAsText: (uri) => { keptAsText.add(uri.toString()); }, release: (uri) => { keptAsText.delete(uri.toString()); } };
}

/**
 * Registers the deck's two Reopen commands, `labshelf.decks.reopenAsDeck` and `labshelf.decks.reopenAsText`: each switches a deck between the
 * text editor and the deck editor, closing the tab it was reopened from; a deck reopened as text stays text for the session.
 */
export function registerDeckReopen(context: vscode.ExtensionContext, logger?: ILogger): void {
  const active = followActiveDeck(context, DECK_EDITOR_VIEW_TYPE, logger);
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.decks.reopenAsDeck", (uri?: vscode.Uri) => {
      const target = uri ?? activeTabUri();
      if (target) active.release(target);
      return reopenWith(DECK_EDITOR_VIEW_TYPE, target);
    }),
    vscode.commands.registerCommand("labshelf.decks.reopenAsText", (uri?: vscode.Uri) => {
      const target = uri ?? activeTabUri();
      if (target) active.keepAsText(target);
      return reopenWith("default", target);
    }),
  );
}

/** One deck editor per document, kept alive while hidden; not registerCustomEditorWithReopen, which allows several editors per document. */
export function registerDeckEditor(context: vscode.ExtensionContext, deps: DeckEditorProviderDeps & DeckCommandDeps): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(DECK_EDITOR_VIEW_TYPE, createDeckEditorProvider(deps), {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  }));
  registerDeckCommands(context, deps);
  registerDeckReopen(context, deps.logger);
}
