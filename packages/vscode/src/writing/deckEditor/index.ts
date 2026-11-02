// Registers the LabShelf deck editor, an optional custom editor for a talk's or poster's deck.html (talks/*/deck.html, posters/*/deck.html).
import * as vscode from "vscode";

import { registerDeckCommands } from "./commands.js";
import { registerDeckReopen } from "./reopen.js";
import { createDeckEditorProvider, type DeckEditorProviderDeps } from "./provider.js";

export type { DeckEditorProviderDeps } from "./provider.js";
export { registerDeckCommands } from "./commands.js";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";

/** One deck editor per document, kept alive while hidden; not registerCustomEditorWithReopen, which allows several editors per document. */
export function registerDeckEditor(context: vscode.ExtensionContext, deps: DeckEditorProviderDeps): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(DECK_EDITOR_VIEW_TYPE, createDeckEditorProvider(deps), {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: false,
  }));
  registerDeckCommands(context, deps);
  registerDeckReopen(context);
}
