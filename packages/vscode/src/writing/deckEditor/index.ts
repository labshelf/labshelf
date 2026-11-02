// Registers the LabShelf deck editor, an optional custom editor for a talk's or poster's deck.html (talks/*/deck.html, posters/*/deck.html).
import * as vscode from "vscode";

import { registerDeckCommands } from "./commands.js";
import { reopenWith } from "../customEditorTabs.js";
import { createDeckEditorProvider, type DeckEditorProviderDeps } from "./provider.js";

export type { DeckEditorProviderDeps } from "./provider.js";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";

/** Registers the deck's two Reopen commands, `labshelf.decks.reopenAsDeck` and `labshelf.decks.reopenAsText`: each switches a deck between the text editor and the deck editor, closing the tab it was reopened from. */
export function registerDeckReopen(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.decks.reopenAsDeck", (uri?: vscode.Uri) => reopenWith(DECK_EDITOR_VIEW_TYPE, uri)),
    vscode.commands.registerCommand("labshelf.decks.reopenAsText", (uri?: vscode.Uri) => reopenWith("default", uri)),
  );
}

/** One deck editor per document, kept alive while hidden; not registerCustomEditorWithReopen, which allows several editors per document. */
export function registerDeckEditor(context: vscode.ExtensionContext, deps: DeckEditorProviderDeps): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(DECK_EDITOR_VIEW_TYPE, createDeckEditorProvider(deps), {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  }));
  registerDeckCommands(context, deps);
  registerDeckReopen(context);
}
