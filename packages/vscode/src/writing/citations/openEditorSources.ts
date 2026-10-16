// Lets the bibliography update read and edit the documents open in VS Code instead of the files on disk.
import * as vscode from "vscode";

import type { OpenSources } from "@labshelf/core";

function openDocument(file: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === file);
}

export const openEditorSources: OpenSources = {
  text: (file) => openDocument(file)?.getText(),
  // The edit is left unsaved so the user decides when the main file reaches disk.
  async replace(file, text) {
    const document = openDocument(file);
    if (!document) { return false; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    return vscode.workspace.applyEdit(edit);
  },
};
