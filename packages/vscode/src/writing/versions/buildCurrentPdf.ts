// Saves the open files and builds a project so a version command can use the PDF of its sources as they are now.
import * as vscode from "vscode";

import type { ProjectFormat } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import { builtPdf } from "../preview/index.js";

export type ProjectBuilders = Record<ProjectFormat, { request(projectFolder: string, trigger: "command"): Promise<{ status: string } | undefined> }>;

/** `action` names what needs the build ("Marking a version") and `use` why it needs the PDF ("a version keeps its PDF"). */
export interface BuildPurpose {
  action: string;
  use: string;
}

/** @returns the built PDF's path, or undefined after telling the user why there is none */
export async function buildCurrentPdf(builders: ProjectBuilders, project: ReadyProject, purpose: BuildPurpose): Promise<string | undefined> {
  await vscode.workspace.saveAll(false);
  const build = await builders[project.settings.format].request(project.folder, "command");
  if (build?.status !== "succeeded") {
    await vscode.window.showWarningMessage(`${purpose.action} needs a successful build. The build problems are listed in Problems.`);
    return undefined;
  }
  const pdfPath = await builtPdf(project);
  if (!pdfPath) { await vscode.window.showInformationMessage(`Build the project first; ${purpose.use}.`); }
  return pdfPath;
}
