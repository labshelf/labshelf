// Registers the deck's two Reopen commands: switch a deck between the text editor and the deck editor.
import * as vscode from "vscode";

import { reopenWith } from "../customEditorTabs.js";

const DECK_EDITOR_VIEW_TYPE = "labshelf.deckEditor";

/** `labshelf.decks.reopenAsDeck` and `labshelf.decks.reopenAsText`, each closing the tab the deck was reopened from. */
export function registerDeckReopen(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.decks.reopenAsDeck", (uri?: vscode.Uri) => reopenWith(DECK_EDITOR_VIEW_TYPE, uri)),
    vscode.commands.registerCommand("labshelf.decks.reopenAsText", (uri?: vscode.Uri) => reopenWith("default", uri)),
  );
}
