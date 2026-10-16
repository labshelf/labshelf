// Registers Show in Preview: scrolls the active project's preview to the output of the line under the editor cursor.
import * as vscode from "vscode";

import { BUILD_COMMAND } from "../build/index.js";
import { owningProject } from "../mainDocument.js";
import type { WritingProjects } from "../projectStore.js";
import type { BuildPreviews } from "./buildPreviews.js";
import { builtPdf } from "./builtPdf.js";

const SHOW_IN_PREVIEW_COMMAND = "labshelf.writing.showInPreview";

interface ShowInPreviewDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "data" | "list" | "paths">;
  previews: Pick<BuildPreviews, "show" | "revealSource">;
}

async function showInPreview(deps: ShowInPreviewDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const file = editor?.document.uri;
  const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
  const pdf = await builtPdf(deps.projects, project, project?.main);
  if (!editor || !file || !project || !pdf) {
    // The build command opens the preview on success and explains a missing project, main file or format.
    await vscode.commands.executeCommand(BUILD_COMMAND);
    return;
  }
  deps.previews.show(project, pdf, { beside: true });
  await deps.previews.revealSource(project, file.fsPath, editor.selection.active.line + 1);
}

export function registerShowInPreview(deps: ShowInPreviewDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(SHOW_IN_PREVIEW_COMMAND, () => showInPreview(deps)));
}
