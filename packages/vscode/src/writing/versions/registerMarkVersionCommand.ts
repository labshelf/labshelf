// Registers Mark Version: builds the project and snapshots its sources and PDF under a name.
import * as vscode from "vscode";

import { versionSlug, type ProjectEntry } from "@labshelf/core";
import { executeSafely } from "../../commands/index.js";
import { activeProject } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import { buildCurrentPdf, type ProjectBuilders } from "./buildCurrentPdf.js";
import { pickVersionName } from "./pickVersionName.js";

export const MARK_VERSION_COMMAND = "labshelf.writing.markVersion";

interface MarkVersionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths" | "data">;
  builders: ProjectBuilders;
}

async function confirmReplace(deps: MarkVersionDeps, project: ReadyProject, name: string): Promise<boolean> {
  const slug = versionSlug(name);
  const existing = (await deps.projects.data.listVersions(project.folder)).find((version) => version.slug === slug);
  if (!existing) { return true; }
  const answer = await vscode.window.showWarningMessage(
    `Replace version “${existing.name}”?`,
    { modal: true, detail: "Its sources and PDF are replaced by the current ones." },
    "Replace",
  );
  return answer === "Replace";
}

async function markProjectVersion(deps: MarkVersionDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await executeSafely(session.logger, MARK_VERSION_COMMAND, async () => {
    const project = entry?.kind === "ready" ? entry : activeProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to mark a version.");
      return;
    }
    const name = await pickVersionName();
    if (!name || !await confirmReplace(deps, project, name)) { return; }
    // The snapshot keeps the PDF of the sources as they are now, so it builds first.
    const pdfPath = await buildCurrentPdf(deps.builders, project, { action: "Marking a version", use: "a version keeps its PDF" });
    if (!pdfPath) { return; }
    const options = { location: vscode.ProgressLocation.Notification, title: `Marking version "${name}"` };
    await vscode.window.withProgress(options, () =>
      deps.projects.data.markVersion({ folder: project.folder, pdfPath, name, now: new Date() }));
    void vscode.window.showInformationMessage(`Marked version “${name}”.`);
  });
}

export function registerMarkVersionCommand(deps: MarkVersionDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(MARK_VERSION_COMMAND, (entry?: ProjectEntry) => markProjectVersion(deps, entry)),
  );
}
