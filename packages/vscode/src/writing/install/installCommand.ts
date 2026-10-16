// Registers Install Project Papers: imports the papers labshelf.yaml lists that the library lacks, under the listed cite keys.
import * as vscode from "vscode";

import {
  describeInstall, keyResolves, planInstall, summarizeInstall, type ILogger, type InstallResult, type PaperRecord, type ProjectEntry,
} from "@labshelf/core";
import { executeSafely, queueTextLayersOfAdded } from "../../commands/index.js";
import type { PaperImporter, PaperTextLayers } from "../../core/index.js";
import { activeProject } from "../build/index.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";

const INSTALL_COMMAND = "labshelf.installProjectPapers";

/** What the command needs of the open library. */
export interface InstallServices {
  importer: Pick<PaperImporter, "importFromNetwork">;
  textLayers: PaperTextLayers;
  paperService: { listPapers(): Promise<PaperRecord[]> };
  logger: ILogger;
}

interface InstallCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
  services: () => InstallServices | null | undefined;
}

// One at a time: each import's duplicate check must see the papers the earlier ones added.
async function importMissing(services: InstallServices, project: Extract<ProjectEntry, { kind: "ready" }>): Promise<InstallResult[]> {
  const plan = planInstall(project.settings.papers ?? [], await services.paperService.listPapers());
  const total = plan.filter((entry) => entry.kind === "import").length;
  const options = { location: vscode.ProgressLocation.Notification, title: `Installing the papers of "${project.settings.id}"` };
  return vscode.window.withProgress(options, async (progress) => {
    const results: InstallResult[] = [];
    let index = 0;
    for (const entry of plan) {
      if (entry.kind === "import") {
        progress.report({ message: `${++index} of ${total}: ${entry.key}`, ...(index > 1 ? { increment: 100 / total } : {}) });
      }
      const outcome = entry.kind === "import" ? await services.importer.importFromNetwork(entry.doi, undefined, { citeKey: entry.key }) : undefined;
      results.push({ entry, outcome });
    }
    return results;
  });
}

async function installPapers(deps: InstallCommandDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = await deps.host.require();
  const services = deps.services();
  if (!session || !services) { return; }
  await executeSafely(session.logger, INSTALL_COMMAND, async () => {
    const project = entry?.kind === "ready" ? entry : activeProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to install its papers.");
      return;
    }
    const results = await importMissing(services, project);
    queueTextLayersOfAdded(services, results.flatMap(({ outcome }) => (outcome ? [outcome] : [])));
    const summary = summarizeInstall(results);
    const unresolved = results.find((result) => !keyResolves(result));
    const problem = unresolved && describeInstall(unresolved);
    await session.logger.log("INFO", INSTALL_COMMAND, "Project papers installed", { project: project.settings.id, summary: summary.text });
    const show = summary.level === "warn" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(`LabShelf: ${summary.text}${problem ? `. ${problem.text}` : ""}`);
  });
}

export function registerInstallCommand(deps: InstallCommandDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(INSTALL_COMMAND, (entry?: ProjectEntry) => installPapers(deps, entry)),
  );
}
