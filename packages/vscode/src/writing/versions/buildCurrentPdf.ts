// Saves the open files and builds a project so a version command can use the PDF of its sources as they are now.
import * as vscode from "vscode";

import type { ProjectBuilders } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import { builtPdf } from "../preview/index.js";
import type { WritingProjects } from "../session/index.js";

/** `action` names what needs the build ("Marking a version") and `use` why it needs the PDF ("a version keeps its PDF"). */
export interface BuildPurpose {
  action: string;
  use: string;
}

/** @returns the built PDF's path, or undefined after telling the user why there is none */
export async function buildCurrentPdf(
  builders: ProjectBuilders, projects: Pick<WritingProjects, "data" | "paths" | "fs">, project: ReadyProject, purpose: BuildPurpose,
): Promise<string | undefined> {
  await vscode.workspace.saveAll(false);
  const build = await builders[project.settings.format].request(project.folder, project.main ?? "", "command");
  if (build?.status !== "succeeded") {
    await vscode.window.showWarningMessage(`${purpose.action} needs a successful build. The build problems are listed in Problems.`);
    return undefined;
  }
  const pdfPath = await builtPdf(projects, project, project.main);
  if (!pdfPath) { await vscode.window.showInformationMessage(`Build the project first; ${purpose.use}.`); }
  return pdfPath;
}
