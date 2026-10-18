// Reads the text of the files a project search covers, preferring unsaved editor content.
import * as vscode from "vscode";

import type { ILogger, PathOps, SearchScopeMode } from "@labshelf/core";
import { isSearchableFile, listProjectFiles } from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";
import { isInside } from "../mainDocument.js";

export const SEARCH_LOG_MODULE = "writing/search";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ProjectText {
  /** Absolute path. */
  path: string;
  text: string;
}

/** What a search covers: the active file alone, or every searchable file of the project that owns it. */
export interface SearchScope {
  mode: SearchScopeMode;
  /** Absolute path of the project folder. */
  folder: string;
  /** Absolute path of the active file. */
  file: string;
  paths: PathOps;
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
    const relatives = await listProjectFiles({ fs: new NodeLibraryFileSystem(), paths: scope.paths }, scope.folder);
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
  const paths = (await scopedPaths(scope, logger)).filter((path) => isSearchableFile(path) && isInside(scope.paths, scope.folder, path));
  const texts: ProjectText[] = [];
  for (const path of paths.sort()) {
    const document = open.get(path);
    const text = document ? document.getText() : await readFromDisk(path, logger);
    if (text !== undefined) { texts.push({ path, text }); }
  }
  return texts;
}
