// Reads the files a project search covers, preferring unsaved editor content, and replaces search matches in one undoable workspace edit.
import * as vscode from "vscode";

import {
  formatError, isInside, isSearchTextFile, listProjectFiles, matchReplacement,
  type ILogger, type LibraryFileSystem, type MatchPosition, type PathOps, type ProjectText, type SearchScopeKind,
} from "@labshelf/core";

export const SEARCH_LOG_MODULE = "writing/search";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** What a search covers: the active file alone, or every searchable file of the project that owns it. */
export interface SearchScope {
  mode: SearchScopeKind;
  /** Absolute path of the project folder. */
  folder: string;
  /** Absolute path of the active file. */
  file: string;
  paths: PathOps;
  fs: LibraryFileSystem;
}

async function readFromDisk(path: string, logger: ILogger): Promise<string | undefined> {
  const uri = vscode.Uri.file(path);
  try {
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) { return undefined; }
    return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    await logger.log("WARN", SEARCH_LOG_MODULE, "Skipped an unreadable file", { path, error: String(error) });
    return undefined;
  }
}

async function scopedPaths(scope: SearchScope, logger: ILogger): Promise<string[]> {
  if (scope.mode === "file") { return [scope.file]; }
  try {
    const relatives = await listProjectFiles({ fs: scope.fs, paths: scope.paths }, scope.folder);
    return relatives.map((relative) => scope.paths.join(scope.folder, relative));
  } catch (error) {
    await logger.error(SEARCH_LOG_MODULE, error, { action: "list-files", folder: scope.folder });
    throw error;
  }
}

/** The text of the scope's searchable files; a file open in an editor contributes its current, possibly unsaved, text. */
export async function readScopeTexts(scope: SearchScope, logger: ILogger): Promise<ProjectText[]> {
  const open = new Map(vscode.workspace.textDocuments.filter((d) => d.uri.scheme === "file").map((d) => [d.uri.fsPath, d]));
  // INVARIANT: a search never reads outside the project folder, whatever the scope or the active file.
  const paths = (await scopedPaths(scope, logger)).filter((path) => isSearchTextFile(path) && isInside(scope.paths, scope.folder, path));
  const texts: ProjectText[] = [];
  for (const path of paths.sort()) {
    const document = open.get(path);
    const text = document ? document.getText() : await readFromDisk(path, logger);
    if (text !== undefined) { texts.push({ path, text }); }
  }
  return texts;
}

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
export async function writeReplacementsInProject(request: ReplaceRequest): Promise<boolean> {
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
    await vscode.window.showErrorMessage(`Replace in Project failed: ${formatError(error)}`);
    return false;
  }
}
