// Reads a file as the user sees it: the open editor's text before the file on disk.
import * as vscode from "vscode";

/** The text of a file as the user sees it: the open document's, saved or not. */
export async function currentText(file: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === file);
  return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
}
