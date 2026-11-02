// Registers the LabShelf notes editor for LabShelf notes files (a paper's notes.qmd, a project's notes/*.qmd) and the commands that reopen a file in it or as text.
import * as vscode from "vscode";

import { registerCustomEditorWithReopen } from "../customEditorTabs.js";
import { NOTES_EDITOR_VIEW_TYPE, createNotesEditorProvider, type NotesEditorProviderDeps } from "./provider.js";

export { type NotesEditorProviderDeps } from "./provider.js";

/** Opens a notes file in the notes editor; a missing file is created empty first, so a paper without notes yet can take its first one. */
export async function openInNotesEditor(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, NOTES_EDITOR_VIEW_TYPE);
}

export function registerNotesEditor(context: vscode.ExtensionContext, deps: NotesEditorProviderDeps): void {
  context.subscriptions.push(
    ...registerCustomEditorWithReopen(NOTES_EDITOR_VIEW_TYPE, createNotesEditorProvider(deps), "labshelf.notesEditor"),
  );
}
