// Replaces search matches in one undoable workspace edit and saves the files that were clean before.
import * as vscode from "vscode";

import { matchReplacement, type ILogger, type MatchPosition } from "@labshelf/core";
import { SEARCH_LOG_MODULE } from "./projectSearchFiles.js";

export interface ReplaceRequest {
  matches: readonly MatchPosition[];
  pattern: RegExp;
  replacement: string;
  logger: ILogger;
  /** Ask before editing; Replace All sets it. */
  confirm: boolean;
}

async function buildEdit(request: ReplaceRequest): Promise<{ edit: vscode.WorkspaceEdit; documents: vscode.TextDocument[]; count: number; files: number }> {
  const edit = new vscode.WorkspaceEdit();
  const documents = new Map<string, vscode.TextDocument>();
  const edited = new Set<string>();
  let count = 0;
  for (const { path, line, column, length } of request.matches) {
    let document = documents.get(path);
    if (!document) {
      document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      documents.set(path, document);
    }
    if (line >= document.lineCount) { continue; }
    // A span that no longer matches was edited since the search; it is left alone.
    const text = matchReplacement(document.lineAt(line).text, request.pattern, { column, length }, request.replacement);
    if (text === undefined) { continue; }
    edit.replace(document.uri, new vscode.Range(line, column, line, column + length), text);
    edited.add(path);
    count += 1;
  }
  return { edit, documents: [...documents.values()], count, files: edited.size };
}

async function confirmed(count: number, files: number): Promise<boolean> {
  const question = `Replace ${count} ${count === 1 ? "match" : "matches"} in ${files} ${files === 1 ? "file" : "files"}?`;
  return (await vscode.window.showWarningMessage(question, { modal: true }, "Replace All")) === "Replace All";
}

/** Edits the matches that still match; failures are logged and shown. Returns whether the edit was applied. */
export async function replaceInProject(request: ReplaceRequest): Promise<boolean> {
  try {
    const { edit, documents, count, files } = await buildEdit(request);
    if (count === 0) {
      await vscode.window.showInformationMessage("No matches to replace.");
      return false;
    }
    if (request.confirm && !(await confirmed(count, files))) { return false; }
    const wasClean = documents.filter((document) => !document.isDirty);
    if (!(await vscode.workspace.applyEdit(edit))) { throw new Error("VS Code rejected the edit"); }
    // Files that held unsaved edits stay dirty so the user decides about them.
    for (const document of wasClean) { await document.save(); }
    await request.logger.log("INFO", SEARCH_LOG_MODULE, "Replaced matches in a project", { matches: count, files });
    return true;
  } catch (error) {
    await request.logger.error(SEARCH_LOG_MODULE, error, { action: "replace", matches: request.matches.length });
    await vscode.window.showErrorMessage(`Replace in Project failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
