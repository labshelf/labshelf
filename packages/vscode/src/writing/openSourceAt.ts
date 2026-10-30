// Opens a file at a line in the editor the user would get for it: the LabShelf editor for .tex and .typ files unless workbench.editorAssociations sends them elsewhere, the text editor for anything else.
import * as vscode from "vscode";
import { isInputPatternMatch } from "@labshelf/core";

import type { ActiveSource } from "./activeSource.js";

const LABSHELF_EDITOR_VIEW_TYPE = "labshelf.sourceEditor";
const SOURCE_FILE = /\.(tex|typ)$/i;
const VIEW_WAIT_MS = 2000;
const VIEW_POLL_MS = 50;

type OpenViews = Pick<ActiveSource, "openFor">;

export interface OpenSourceOptions {
  viewColumn?: vscode.ViewColumn;
  /** Selects this range in a text editor; the LabShelf editor reveals its first line. Defaults to the start of `line`. */
  selection?: vscode.Range;
  revealType?: vscode.TextEditorRevealType;
  /** The open LabShelf editors; defaults to the extension's one ActiveSource, set when the LabShelf editor is registered. */
  activeSource?: OpenViews;
}

let registeredViews: OpenViews | undefined;

/** Called once by the LabShelf editor's registration, so callers without the ActiveSource at hand still reveal in its views. */
export function useActiveSourceForOpens(views: OpenViews | undefined): void {
  registeredViews = views;
}

/** Whether a workbench.editorAssociations pattern matches the file: a pattern without a slash is matched against the file name, one with a slash against the whole path. */
function isAssociationMatch(pattern: string, uri: vscode.Uri): boolean {
  const path = uri.path;
  if (!pattern.includes("/")) { return isInputPatternMatch(pattern, path.slice(path.lastIndexOf("/") + 1)); }
  return isInputPatternMatch(pattern.replace(/^\/+/, ""), path.replace(/^\/+/, ""));
}

/** Whether VS Code opens the file in the LabShelf editor: a .tex or .typ file that no workbench.editorAssociations entry sends to another editor. */
export function opensInLabShelfEditor(uri: vscode.Uri): boolean {
  if (!SOURCE_FILE.test(uri.path)) { return false; }
  const associations = vscode.workspace.getConfiguration("workbench").get<unknown>("editorAssociations");
  if (!associations || typeof associations !== "object" || Array.isArray(associations)) { return true; }
  return !Object.entries(associations as Record<string, unknown>).some(
    ([pattern, viewType]) => viewType !== LABSHELF_EDITOR_VIEW_TYPE && isAssociationMatch(pattern, uri),
  );
}

/** Resolves to the LabShelf view on the file once it registers, or undefined after about two seconds. */
async function waitForView(views: OpenViews, uri: vscode.Uri): Promise<ReturnType<OpenViews["openFor"]>> {
  const deadline = Date.now() + VIEW_WAIT_MS;
  for (;;) {
    const view = views.openFor(uri);
    if (view || Date.now() >= deadline) { return view; }
    await new Promise((resolve) => setTimeout(resolve, VIEW_POLL_MS));
  }
}

async function showInTextEditor(uri: vscode.Uri, line: number | undefined, options: OpenSourceOptions): Promise<void> {
  const position = Math.max(0, (line ?? 1) - 1);
  const range = options.selection ?? (line === undefined ? undefined : new vscode.Range(position, 0, position, 0));
  const editor = await vscode.window.showTextDocument(uri, {
    ...(options.viewColumn === undefined ? {} : { viewColumn: options.viewColumn }),
    ...(range ? { selection: range } : {}),
  });
  if (range) { editor.revealRange(range, options.revealType ?? vscode.TextEditorRevealType.InCenter); }
}

/** Opens `uri` at the 1-based `line`: an open LabShelf editor on it is revealed; a file the LabShelf editor is the effective editor for opens in it (vscode.openWith) and reveals the line once its view registers; anything else opens in the text editor. */
export async function openSourceAt(uri: vscode.Uri, line: number | undefined, options: OpenSourceOptions = {}): Promise<void> {
  const views = options.activeSource ?? registeredViews;
  const target = line ?? (options.selection ? options.selection.start.line + 1 : undefined);
  const open = views?.openFor(uri);
  if (open) {
    if (target !== undefined) { open.reveal(target); }
    return;
  }
  if (views && opensInLabShelfEditor(uri)) {
    await vscode.commands.executeCommand("vscode.openWith", uri, LABSHELF_EDITOR_VIEW_TYPE, options.viewColumn === undefined ? {} : { viewColumn: options.viewColumn });
    const view = await waitForView(views, uri);
    if (view) {
      if (target !== undefined) { view.reveal(target); }
      return;
    }
  }
  await showInTextEditor(uri, line, options);
}
