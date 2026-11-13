// LabShelf text writes through the window's open TextDocument: the document is the live copy (D1), so a write to an
// open file edits and saves it instead of replacing the file behind it, and a read sees its unsaved text.
import * as vscode from "vscode";

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

/** The document of uri open in this window, matched by the uri's string form; a closed document does not count. */
export function openDocumentOf(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((document) => !document.isClosed && document.uri.toString() === key);
}

/** Replaces the document's text with one edit over only the changed range; does not save. */
export async function replaceDocumentText(document: vscode.TextDocument, text: string): Promise<void> {
  const replace = minimalReplace(document.getText(), text);
  if (!replace) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(replace.from), document.positionAt(replace.to)), replace.insert);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error(`Could not edit ${document.uri.fsPath}`);
}

/**
 * Writes text through the open document of uri and saves it; false, touching nothing, when no document is open.
 * A document with unsaved edits elsewhere is saved with them: it is the live copy.
 */
export async function writeThroughDocument(uri: vscode.Uri, text: string): Promise<boolean> {
  const document = openDocumentOf(uri);
  if (!document) return false;
  await replaceDocumentText(document, text);
  if (document.isDirty && !await document.save()) throw new Error(`Could not save ${document.uri.fsPath}`);
  return true;
}
