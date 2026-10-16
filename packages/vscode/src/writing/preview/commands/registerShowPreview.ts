// Registers Show Preview: opens the active project's built PDF in the reader, building it first when it does not exist.
import * as vscode from "vscode";

import { BUILD_COMMAND } from "../../build/index.js";
import { owningProject } from "../../mainDocument.js";
import type { WritingProjects } from "../../session/index.js";
import type { BuildPreviews } from "../projectPreview/index.js";
import { builtPdf } from "../builtPdf.js";

const SHOW_PREVIEW_COMMAND = "labshelf.writing.showPreview";

interface ShowPreviewDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "data" | "list" | "paths">;
  previews: Pick<BuildPreviews, "show">;
}

async function showPreview(deps: ShowPreviewDeps): Promise<void> {
  const file = vscode.window.activeTextEditor?.document.uri;
  const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
  const pdf = await builtPdf(deps.projects, project, project?.main);
  if (project?.main && pdf) {
    deps.previews.show(project, project.main, pdf, { beside: false });
    return;
  }
  // The build command opens the preview on success and explains a missing project, main file or format.
  await vscode.commands.executeCommand(BUILD_COMMAND);
}

export function registerShowPreview(deps: ShowPreviewDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(SHOW_PREVIEW_COMMAND, () => showPreview(deps)));
}
