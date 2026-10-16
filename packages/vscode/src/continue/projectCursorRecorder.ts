// Saves where the user is editing in a writing project, so any window can offer to continue there.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";

import { mainPathIn, owningProject, type WritingProjects } from "../writing/index.js";

const MODULE = "continue";
const SETTLE_MS = 2000;

export interface CursorRecorderDeps {
  projects: WritingProjects;
  logger: () => ILogger | undefined;
  /** Called after a cursor was saved. */
  onRecorded: () => void;
}

/** Records the active editor's position in its project after the cursor settles and on save. */
export function registerProjectCursorRecorder(context: vscode.ExtensionContext, deps: CursorRecorderDeps): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = "";

  const record = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const logger = deps.logger();
    if (!editor || !logger || editor.document.uri.scheme !== "file") { return; }
    const filePath = editor.document.uri.fsPath;
    const project = owningProject(deps.projects, filePath);
    if (!project) { return; }
    const { line, character } = editor.selection.active;
    const file = mainPathIn(deps.projects.paths, project, filePath);
    const position = `${project.folder}\n${file}\n${line}:${character}`;
    if (position === lastSaved) { return; }
    try {
      await deps.projects.data.writeProjectCursor(project.folder, { file, line, character, updatedAt: new Date().toISOString() });
      lastSaved = position;
      deps.onRecorded();
    } catch (error) {
      await logger.error(MODULE, error, { folder: project.folder, file, action: "write cursor" });
    }
  };

  const settle = (): void => {
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => void record(), SETTLE_MS);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(settle),
    vscode.window.onDidChangeTextEditorSelection(settle),
    vscode.workspace.onDidSaveTextDocument(() => void record()),
    new vscode.Disposable(() => { if (timer) { clearTimeout(timer); } }),
  );
}
