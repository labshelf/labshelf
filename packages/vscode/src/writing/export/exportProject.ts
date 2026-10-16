// Runs the preview's Export items: saves the project or an arXiv bundle as a zip, or opens the built PDF in the system viewer.
import { zipSync } from "fflate";
import * as vscode from "vscode";

import type { ExportTarget, ILogger } from "@labshelf/core";

import type { ReadyProject } from "../mainDocument.js";
import { builtPdf } from "../preview/builtPdf.js";
import type { WritingProjects } from "../session/index.js";
import { arxivZipEntries, projectZipEntries } from "./exportBundle.js";

const MODULE = "writing.export";

export interface ExportProjectDeps {
  logger: ILogger;
  projects: Pick<WritingProjects, "data" | "paths">;
}

async function openBuiltPdf(deps: ExportProjectDeps, project: ReadyProject, root: string): Promise<void> {
  const pdf = await builtPdf(deps.projects, project, root);
  if (!pdf) {
    void vscode.window.showInformationMessage(`Build ${root} to open its PDF.`);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.file(pdf));
}

async function saveZip(deps: ExportProjectDeps, project: ReadyProject, root: string, target: "projectZip" | "arxivZip"): Promise<void> {
  const name = `${project.settings.id}${target === "arxivZip" ? "-arxiv" : ""}.zip`;
  const destination = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(project.folder), name),
    filters: { Zip: ["zip"] },
  });
  if (!destination) { return; }
  const entries = target === "arxivZip"
    ? await arxivZipEntries(deps.projects.paths, project, root)
    : await projectZipEntries(deps.projects.paths, project);
  await vscode.workspace.fs.writeFile(destination, zipSync(entries));
}

/** Exports the project for the target; a cancelled save dialog does nothing and a failure is logged and shown. */
export async function exportProject(deps: ExportProjectDeps, project: ReadyProject, root: string, target: ExportTarget): Promise<void> {
  try {
    if (target === "systemViewer") { await openBuiltPdf(deps, project, root); }
    else { await saveZip(deps, project, root, target); }
  } catch (error) {
    await deps.logger.error(MODULE, error, { project: project.settings.id, root, target });
    void vscode.window.showErrorMessage(`Could not export ${project.settings.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
