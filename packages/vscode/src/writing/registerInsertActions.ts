// Registers the Insert Symbol, Insert Table and Insert Image commands for the active LaTeX or Typst editor.
import * as vscode from "vscode";

import {
  MATH_SYMBOLS,
  MAX_TABLE_SIDE,
  parseTableSize,
  deriveSymbolSource,
  createTableSnippet,
  IMAGE_EXTENSIONS,
  IMAGE_FOLDER,
  findFreeImageName,
  deriveImageBaseFolder,
  createImageSnippet,
  isInside,
  type ILogger,
} from "@labshelf/core";

import {
  type ProjectFinder,
  findOwningProject,
  type ReadyProject,
} from "./buildRootDocument.js";
import type { WritingHost } from "./session/index.js";
import { readWritingLanguage, type WritingLanguage } from "./editorLanguage.js";

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** Copies into the project's images folder under a free name; an existing file is never overwritten. */
async function copyIntoProject(projects: ProjectFinder, project: ReadyProject, source: string): Promise<string> {
  const { paths } = projects;
  const folder = paths.join(project.folder, IMAGE_FOLDER);
  const target = await findFreeImageName(paths, folder, paths.basename(source), (path) => exists(vscode.Uri.file(path)));
  await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(target), { overwrite: false });
  return target;
}

async function insertImage(editor: vscode.TextEditor, language: WritingLanguage, projects: ProjectFinder, logger: ILogger | undefined): Promise<void> {
  const documentPath = editor.document.uri.fsPath;
  const project = findOwningProject(projects, documentPath);
  if (!project) { return; }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(project.folder),
    filters: { Images: IMAGE_EXTENSIONS[language] },
    openLabel: "Insert Image",
  });
  const source = picked?.[0]?.fsPath;
  if (!source) { return; }
  const { paths } = projects;
  let image = source;
  if (!isInside(paths, project.folder, source)) {
    try {
      image = await copyIntoProject(projects, project, source);
      await logger?.log("INFO", "writing/editorActions", "Copied an image into the project", { source, image });
    } catch (error) {
      await logger?.log("ERROR", "writing/editorActions", "Could not copy the image into the project", { source, folder: project.folder, error: String(error) });
      void vscode.window.showErrorMessage(`Could not copy the image into the project: ${String(error)}`);
      return;
    }
  }
  const relative = paths.relative(deriveImageBaseFolder(language, project.folder, project.main, documentPath, paths), image).split(paths.sep).join("/");
  await editor.insertSnippet(new vscode.SnippetString(createImageSnippet(language, relative)));
}

interface InsertActionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: ProjectFinder;
}

interface SymbolItem extends vscode.QuickPickItem {
  source?: string;
}

function symbolItems(language: WritingLanguage): SymbolItem[] {
  return MATH_SYMBOLS.flatMap((symbol, index) => {
    const source = deriveSymbolSource(symbol, language);
    const item: SymbolItem = { label: symbol.glyph, description: source, source };
    const startsCategory = MATH_SYMBOLS[index - 1]?.category !== symbol.category;
    return startsCategory ? [{ label: symbol.category, kind: vscode.QuickPickItemKind.Separator }, item] : [item];
  });
}

async function insertSymbol(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const picked = await vscode.window.showQuickPick(symbolItems(language), { title: "Insert Symbol", placeHolder: "Search by name, e.g. alpha or arrow", matchOnDescription: true });
  if (!picked?.source) { return; }
  await editor.insertSnippet(new vscode.SnippetString().appendText(picked.source));
}

async function insertTable(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Insert Table",
    prompt: "Columns x rows",
    value: "3x3",
    validateInput: (value) => parseTableSize(value) ? undefined : `Enter columns x rows, each from 1 to ${MAX_TABLE_SIDE}, e.g. 3x2`,
  });
  const size = input === undefined ? undefined : parseTableSize(input);
  if (!size) { return; }
  await editor.insertSnippet(new vscode.SnippetString(createTableSnippet(language, size)));
}

export function registerInsertActions(deps: InsertActionDeps): void {
  const actions: Record<string, (editor: vscode.TextEditor, language: WritingLanguage) => Promise<void>> = {
    "labshelf.writing.insertSymbol": insertSymbol,
    "labshelf.writing.insertTable": insertTable,
    "labshelf.writing.insertImage": (editor, language) => insertImage(editor, language, deps.projects, deps.host.current()?.logger),
  };
  for (const [command, action] of Object.entries(actions)) {
    deps.context.subscriptions.push(vscode.commands.registerCommand(command, () => {
      const editor = vscode.window.activeTextEditor;
      const language = readWritingLanguage(editor);
      return editor && language ? action(editor, language) : undefined;
    }));
  }
}
