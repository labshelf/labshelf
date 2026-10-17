// Registers the commands of a project entry: Reveal in File Explorer, Remove from LabShelf and Make a Copy.
import * as vscode from "vscode";

import { PROJECT_FILE, projectFileWithId, updateProjectFile, type ProjectEntry, type TemplateFile } from "@labshelf/core";
import { executeSafely } from "../commands/index.js";
import { projectZipEntries } from "./export/index.js";
import type { ReadyProject } from "./mainDocument.js";
import { OPEN_PROJECT_COMMAND, type WritingHost, type WritingProjects } from "./session/index.js";

interface ItemCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
}

async function removeProject({ host, projects }: ItemCommandsDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = host.current();
  if (!session || entry?.location !== "external") { return; }
  await executeSafely(session.logger, "labshelf.writing.removeProject", async () => {
    const remove = "Remove from LabShelf";
    const answer = await vscode.window.showWarningMessage(
      `Remove "${entry.kind === "ready" ? entry.settings.id : entry.folder}" from LabShelf?`,
      { modal: true, detail: `The files in ${entry.folder} are not deleted.` },
      remove,
    );
    if (answer !== remove) { return; }
    await projects.data.unregisterProjectFolder(session.root, entry.folder);
    await projects.reload();
  });
}

/** The files of the copy: the project's exportable files without labshelf.yaml, which the copy writes under its own id. */
async function copyFiles(projects: WritingProjects, entry: ReadyProject): Promise<TemplateFile[]> {
  const entries = await projectZipEntries(projects.paths, entry);
  return Object.entries(entries).filter(([path]) => path !== PROJECT_FILE).map(([path, bytes]) => ({ path, bytes }));
}

/** Copies a project under `title` and opens the copy; the copy starts in the projects list, not in the archive or the trash. */
export async function duplicateProject({ host, projects }: Pick<ItemCommandsDeps, "host" | "projects">, entry: ProjectEntry, title: string): Promise<void> {
  const session = host.current();
  if (!session) { throw new Error("open a library before copying a project"); }
  if (entry.kind !== "ready") { throw new Error(`${entry.folder} cannot be read, so it cannot be copied`); }
  const { id, format, engine } = entry.settings;
  if (!entry.main) { throw new Error(`set the main document of ${id} to copy it`); }
  const template = { id, format, main: entry.main, ...(engine ? { engine } : {}) };
  const copy = await projects.data.createProjectFromTemplate(session.root, { title, template, files: await copyFiles(projects, entry) });
  if (copy.kind !== "ready") { throw new Error(`the copy in ${copy.folder} cannot be read`); }
  // The original labshelf.yaml carries keys a template install does not write: figures, values, check limits, papers.
  const settingsFile = vscode.Uri.joinPath(vscode.Uri.file(entry.folder), PROJECT_FILE);
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(settingsFile));
  const copied = updateProjectFile(projectFileWithId(text, copy.settings.id), {
    title: title === copy.settings.id ? undefined : title, archived: undefined, trashed: undefined,
  });
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.Uri.file(copy.folder), PROJECT_FILE), new TextEncoder().encode(copied));
  await session.logger.log("INFO", "writing.project", "project copied", { from: entry.folder, to: copy.folder });
  await projects.reload();
  await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, projects.list().find((p) => p.folder === copy.folder) ?? copy);
}

async function copyProject(deps: ItemCommandsDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session || entry?.kind !== "ready") { return; }
  await executeSafely(session.logger, "labshelf.writing.copyProject", async () => {
    const { id } = entry.settings;
    if (!entry.main) { void vscode.window.showWarningMessage(`Set the main document of ${id} to copy it.`); return; }
    const title = (await vscode.window.showInputBox({ prompt: `Title of the copy of ${id}`, value: `${entry.settings.title ?? id} copy` }))?.trim();
    if (!title) { return; }
    await duplicateProject(deps, entry, title);
  });
}

export function registerProjectItemCommands(deps: ItemCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.reveal", (entry?: ProjectEntry) =>
      entry ? vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(entry.folder)) : undefined),
    vscode.commands.registerCommand("labshelf.writing.removeProject", (entry?: ProjectEntry) => removeProject(deps, entry)),
    vscode.commands.registerCommand("labshelf.writing.copyProject", (entry?: ProjectEntry) => copyProject(deps, entry)),
  );
}
