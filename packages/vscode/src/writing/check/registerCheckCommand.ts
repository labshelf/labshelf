// Registers Check Before Submitting: builds the project, checks its PDF and sources, and lists the findings in Problems.
import * as vscode from "vscode";

import type { CheckFinding, ILogger, ProjectFormat } from "@labshelf/core";
import { checkProject, type PdfjsLoader, type ProjectEntry } from "@labshelf/core/node";
import { executeSafely } from "../../commands/index.js";
import { activeProject, ProjectDiagnostics } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import { builtPdf } from "../preview/index.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import { checkDiagnostics } from "./checkDiagnostics.js";

export const CHECK_COMMAND = "labshelf.writing.checkBeforeSubmitting";

interface CheckCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list">;
  builders: Record<ProjectFormat, { request(projectFolder: string, trigger: "command"): Promise<{ status: string } | undefined> }>;
  pdfjs: PdfjsLoader;
}

function summary(count: number): string {
  return `${count} ${count === 1 ? "problem" : "problems"} found before submitting.`;
}

function runCheck(deps: CheckCommandDeps, project: ReadyProject, pdfPath: string, logger: ILogger): Thenable<CheckFinding[]> {
  const options = { location: vscode.ProgressLocation.Notification, title: `Checking "${project.settings.id}" before submitting` };
  return vscode.window.withProgress(options, () =>
    checkProject({ folder: project.folder, pdfPath, settings: project.settings.check }, deps.pdfjs, logger));
}

async function checkBeforeSubmitting(deps: CheckCommandDeps, diagnostics: ProjectDiagnostics, entry: ProjectEntry | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await executeSafely(session.logger, CHECK_COMMAND, async () => {
    const project = entry?.kind === "ready" ? entry : activeProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to check it.");
      return;
    }
    // The check reads the PDF of the sources as they are now, so it builds first.
    await vscode.workspace.saveAll(false);
    const build = await deps.builders[project.settings.format].request(project.folder, "command");
    if (build?.status !== "succeeded") {
      await vscode.window.showWarningMessage("The check needs a successful build. The build problems are listed in Problems.");
      return;
    }
    const pdfPath = await builtPdf(project);
    if (!pdfPath) {
      await vscode.window.showInformationMessage("Build the project first; the check reads its PDF.");
      return;
    }
    const findings = await runCheck(deps, project, pdfPath, session.logger);
    diagnostics.replace(project.folder, checkDiagnostics(findings, pdfPath));
    if (findings.length === 0) {
      void vscode.window.showInformationMessage("No problems found before submitting.");
      return;
    }
    await vscode.commands.executeCommand("workbench.actions.view.problems");
    void vscode.window.showInformationMessage(summary(findings.length));
  });
}

export function registerCheckCommand(deps: CheckCommandDeps): void {
  const diagnostics = new ProjectDiagnostics("labshelf-check");
  deps.context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand(CHECK_COMMAND, (entry?: ProjectEntry) => checkBeforeSubmitting(deps, diagnostics, entry)),
  );
}
