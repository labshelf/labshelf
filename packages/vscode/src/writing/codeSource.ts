// Where a manuscript's code listings read their files in VS Code: relative to the project folder, inside a workspace folder or picked
// by the user on this machine, from the open document when there is one; Browse… picks one, and Open source shows one at its lines.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";
import {
  CODE_FILE_EXTENSIONS, CODE_FILE_GLOB, deriveCodeLanguage, deriveCodeLinkPath, isInside, posixPathOps, resolveCodeLinkFile, type CodeLinkSource,
} from "@labshelf/core";

/** Folders never searched for code: dependencies, environments, caches and LabShelf's own data. */
const CODE_SEARCH_EXCLUDE = "**/{node_modules,.git,.venv,venv,__pycache__,.labshelf}/**";
const MAX_CODE_FILES = 5000;
/** The globalState key of the code files the user picked outside the workspace; machine-local, never registered for settings sync. */
const PICKED_KEY = "labshelf.writing.pickedCodeFiles";

/** Where the picked files are kept; until the extension sets it, no file outside the workspace is readable. */
let pickedStore: vscode.Memento | undefined;

/** Keeps the allow-list of picked code files in the extension's globalState, this machine only. */
export function usePickedCodeFiles(state: vscode.Memento): void { pickedStore = state; }

/** The picked files as absolute, normalised file paths. */
const pickedFiles = (): string[] => pickedStore?.get<string[]>(PICKED_KEY) ?? [];

/** The workspace folders on the project's scheme and authority, as URI paths. */
function workspaceFolderPaths(projectRoot: vscode.Uri): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter(({ uri }) => uri.scheme === projectRoot.scheme && uri.authority === projectRoot.authority)
    .map(({ uri }) => uri.path);
}

/**
 * The one rule every reader of code goes through (the editor's requests, the native marks, the checklist, Open source):
 * the file a listing's path names relative to the project folder, inside a workspace folder or picked by the user; any other path throws.
 */
export function resolveCodeFile(projectRoot: vscode.Uri | undefined, path: string): vscode.Uri {
  if (!projectRoot) { throw new Error("outside the project"); }
  const picked = projectRoot.scheme === "file" ? pickedFiles().map((file) => vscode.Uri.file(file).path) : [];
  const file = resolveCodeLinkFile(posixPathOps, projectRoot.path, path, { workspaceFolders: workspaceFolderPaths(projectRoot), picked });
  if (file === undefined) { throw new Error(`${path} is outside the workspace and was not picked on this computer`); }
  return projectRoot.with({ path: file });
}

/** Adds a code file the user chose to the allow-list; a file inside a workspace folder needs no entry. */
export async function allowCodeFile(file: vscode.Uri): Promise<void> {
  if (file.scheme !== "file" || !pickedStore) { return; }
  const inside = workspaceFolderPaths(file).some((folder) => isInside(posixPathOps, folder, file.path));
  const normalised = vscode.Uri.file(file.fsPath).fsPath;
  const picked = pickedFiles();
  if (inside || picked.includes(normalised)) { return; }
  await pickedStore.update(PICKED_KEY, [...picked, normalised]);
}

/**
 * The text of a code file named relative to the project folder, from the open document when there is one; undefined when it
 * does not exist or is a folder. A path the rule refuses throws, so its listing gets no mark and the file is never read.
 */
export async function readCodeFile(projectRoot: vscode.Uri | undefined, path: string): Promise<string | undefined> {
  const target = resolveCodeFile(projectRoot, path);
  const key = target.toString();
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
  if (open) { return open.getText(); }
  try {
    if ((await vscode.workspace.fs.stat(target)).type & vscode.FileType.Directory) { return undefined; }
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") { return undefined; }
    throw error;
  }
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
}

/** The code files of a project folder (a file system path), for the native marks and the checklist. */
export function createCodeLinkSource(folder: string): CodeLinkSource {
  const projectRoot = vscode.Uri.file(folder);
  return { read: (path) => readCodeFile(projectRoot, path) };
}

/**
 * Shows the OS file dialog over code files and answers the picked file's path relative to the project folder, after adding it
 * to the allow-list; undefined when the user cancels, or picks a file that is not code or that no relative path reaches (another drive).
 */
export async function browseCodeFile(projectRoot: vscode.Uri): Promise<string | undefined> {
  const [file] = await vscode.window.showOpenDialog({
    canSelectMany: false, canSelectFiles: true, canSelectFolders: false, defaultUri: projectRoot, openLabel: "Pick",
    title: "Insert code from a file", filters: { Code: [...CODE_FILE_EXTENSIONS], "All files": ["*"] },
  }) ?? [];
  if (!file) { return undefined; }
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (!isCodeFile(file.path)) {
    void vscode.window.showWarningMessage(`${name} is not a code file LabShelf knows (.py, .R, .jl…).`);
    return undefined;
  }
  const path = file.scheme === projectRoot.scheme && file.authority === projectRoot.authority ? deriveCodeLinkPath(posixPathOps, projectRoot.path, file.path) : undefined;
  if (path === undefined) {
    void vscode.window.showWarningMessage(`${name} is on another drive than the project; move it or copy it next to the project to insert it.`);
    return undefined;
  }
  await allowCodeFile(file);
  return path;
}

/** Opens a code file in the text editor of the active group with the 1-based line selected and centred; at its start without a line. */
export async function openCodeFileAt(target: vscode.Uri, line: number | undefined): Promise<void> {
  const document = await vscode.workspace.openTextDocument(target);
  if (line === undefined) { await vscode.window.showTextDocument(document); return; }
  const range = document.lineAt(Math.min(Math.max(0, line - 1), document.lineCount - 1)).range;
  const editor = await vscode.window.showTextDocument(document, { selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/** A file whose saves and changes can move a listing's state or that can be inserted as code: a known code language, a LaTeX file excluded. */
export const isCodeFile = (path: string): boolean => !/\.tex$/i.test(path) && deriveCodeLanguage(path.replace(/\\/g, "/")) !== undefined;

/**
 * The workspace's code files as POSIX paths relative to the project folder (`../analysis/fit.py`): code usually sits
 * beside the manuscript's folder, not in it. Files inside the project come first, then by path.
 */
export async function listWorkspaceCodeFiles(projectFolder: vscode.Uri): Promise<string[]> {
  const found = await vscode.workspace.findFiles(CODE_FILE_GLOB, CODE_SEARCH_EXCLUDE, MAX_CODE_FILES);
  const paths = found.filter((uri) => uri.scheme === projectFolder.scheme && uri.authority === projectFolder.authority && isCodeFile(uri.path))
    .map((uri) => posixPathOps.relative(projectFolder.path, uri.path));
  const outside = (path: string): number => (path.startsWith("../") ? 1 : 0);
  return paths.sort((a, b) => outside(a) - outside(b) || a.localeCompare(b));
}
