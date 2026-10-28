// Commands that act on writing projects: finding the project a file belongs to, choosing its main file, adding, removing and copying projects.
import * as vscode from "vscode";

import {
  PROJECT_FILE, createBlankTemplate, detectFormat, findEntryCandidates, isInside, updateProjectFile, withProjectId,
  type PathOps, type ProjectEntry, type ProjectFormat, type TemplateFile,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { readActiveProject } from "../build/index.js";
import { OPEN_PROJECT_COMMAND, type WritingHost, type WritingProjects } from "./session.js";
import { listProjectZipEntries } from "./exportInstall.js";

// ---- Owning project and main-file path

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** The project list together with the path style its folders are written in. */
export type ProjectFinder = Pick<WritingProjects, "list" | "paths">;

/** The ready project whose folder contains the file; the deepest folder wins when projects are nested. */
export function findOwningProject(projects: ProjectFinder, filePath: string): ReadyProject | undefined {
  let owner: ReadyProject | undefined;
  for (const entry of projects.list()) {
    if (entry.kind !== "ready" || !isInside(projects.paths, entry.folder, filePath)) { continue; }
    if (!owner || entry.folder.length > owner.folder.length) { owner = entry; }
  }
  return owner;
}

/** The file's path relative to the project folder, with "/" separators on every platform, as labshelf.yaml stores it. */
export function deriveBuildRootPath(paths: PathOps, project: ReadyProject, filePath: string): string {
  return paths.relative(project.folder, filePath).split(paths.sep).join("/");
}

// ---- Main document

interface MainCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "reload">;
}

async function writeMain(deps: MainCommandsDeps, project: ReadyProject, main: string): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await runSafely(session.logger, "labshelf.writing.setMain", async () => {
    await deps.projects.data.updateProjectSettings(project.folder, { main });
    await deps.projects.reload();
  });
}

async function setMain(deps: MainCommandsDeps, file: vscode.Uri | undefined): Promise<void> {
  if (!file) { return; }
  const project = findOwningProject(deps.projects, file.fsPath);
  if (!project) {
    await vscode.window.showErrorMessage(`${deps.projects.paths.basename(file.fsPath)} is not inside a LabShelf project.`);
    return;
  }
  if (findEntryCandidates(project.settings.format, [deps.projects.paths.basename(file.fsPath)]).length === 0) {
    await vscode.window.showErrorMessage(
      `${deps.projects.paths.basename(file.fsPath)} does not match the ${project.settings.format} format of project "${project.settings.id}".`,
    );
    return;
  }
  await writeMain(deps, project, deriveBuildRootPath(deps.projects.paths, project, file.fsPath));
}

async function pickMain(deps: MainCommandsDeps): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const project = active ? findOwningProject(deps.projects, active) : undefined;
  if (!project) { return; }
  const candidates = findEntryCandidates(project.settings.format, await deps.projects.data.rootFileNames(project.folder));
  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(`Project "${project.settings.id}" has no ${project.settings.format} file in its folder.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((name) => ({ label: name, description: name === project.main ? "current main" : "" })),
    { placeHolder: `Main document of ${project.settings.id}` },
  );
  if (picked && picked.label !== project.main) { await writeMain(deps, project, picked.label); }
}

export function registerBuildRootCommands(deps: MainCommandsDeps): void {
  deps.context.subscriptions.push(
    // The sidebar Files tree passes its row ({ uri }); editors and the Explorer pass a Uri.
    vscode.commands.registerCommand("labshelf.writing.setMain", (file?: vscode.Uri | { uri: vscode.Uri }) => setMain(deps, file instanceof vscode.Uri ? file : file?.uri)),
    vscode.commands.registerCommand("labshelf.writing.pickMain", () => pickMain(deps)),
  );
}

const PICK_MAIN_COMMAND = "labshelf.writing.pickMain";

export function registerBuildRootStatusBar(context: vscode.ExtensionContext, projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = PICK_MAIN_COMMAND;

  const update = (): void => {
    const project = readActiveProject(projects);
    if (!project) {
      item.hide();
      return;
    }
    item.text = `$(file) ${project.main ?? "no main file"}`;
    item.tooltip = `Main document of ${project.settings.id}. Click to change it.`;
    item.show();
  };

  context.subscriptions.push(item, projects.onDidChange(update), vscode.window.onDidChangeActiveTextEditor(update));
  update();
}

// ---- Adding projects

interface ProjectCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
}

async function pickFormat(placeHolder: string): Promise<ProjectFormat | undefined> {
  const picked = await vscode.window.showQuickPick(
    [{ label: "LaTeX", format: "latex" as const }, { label: "Typst", format: "typst" as const }],
    { placeHolder },
  );
  return picked?.format;
}

async function newBlankProject({ host, projects }: ProjectCommandsDeps): Promise<void> {
  const session = await host.require();
  if (!session) { return; }
  await runSafely(session.logger, "labshelf.writing.newBlankProject", async () => {
    const title = (await vscode.window.showInputBox({ prompt: "Project title", placeHolder: "Deep nets survey" }))?.trim();
    if (!title) { return; }
    const format = await pickFormat("Format of the new project");
    if (!format) { return; }
    const entry = await projects.data.createProjectFromTemplate(session.root, { title, ...createBlankTemplate(format, title) });
    await projects.reload();
    await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry);
  });
}

async function addFolder({ host, projects }: ProjectCommandsDeps): Promise<void> {
  const session = await host.require();
  if (!session) { return; }
  await runSafely(session.logger, "labshelf.writing.addExistingFolder", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Add project folder",
    });
    const folder = picked?.[0]?.fsPath;
    if (!folder) { return; }
    const names = await projects.data.rootFileNames(folder);
    // Core keeps an existing labshelf.yaml and ignores the format, so the user is not asked for it.
    const format = detectFormat(names)
      ?? (names.includes(PROJECT_FILE) ? "latex" : await pickFormat("This folder has no .tex or .typ file. Which format is the project?"));
    if (!format) { return; }
    await projects.data.addExistingFolder(session.root, { folder, format });
    await projects.reload();
  });
}

export function registerProjectCommands(deps: ProjectCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.newBlankProject", () => newBlankProject(deps)),
    vscode.commands.registerCommand("labshelf.writing.refresh", () => deps.projects.reload()),
  );
}

/** Registered by the desktop only: a folder outside the library is reachable by path there, not in a web page. */
export function registerAddExistingFolder(deps: ProjectCommandsDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand("labshelf.writing.addExistingFolder", () => addFolder(deps)));
}

// ---- Project entry commands

interface ItemCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
}

async function removeProject({ host, projects }: ItemCommandsDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = host.current();
  if (!session || entry?.location !== "external") { return; }
  await runSafely(session.logger, "labshelf.writing.removeProject", async () => {
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
  const entries = await listProjectZipEntries(projects.paths, entry);
  return Object.entries(entries).filter(([path]) => path !== PROJECT_FILE).map(([path, bytes]) => ({ path, bytes }));
}

/** Copies a project under `title` and opens the copy; the copy starts in the projects list, not in the archive or the trash. */
export async function copyProjectEntry({ host, projects }: Pick<ItemCommandsDeps, "host" | "projects">, entry: ProjectEntry, title: string): Promise<void> {
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
  const copied = updateProjectFile(withProjectId(text, copy.settings.id), {
    title: title === copy.settings.id ? undefined : title, archived: undefined, trashed: undefined,
  });
  await projects.fs.writeText(projects.paths.join(copy.folder, PROJECT_FILE), copied);
  await session.logger.log("INFO", "writing.project", "project copied", { from: entry.folder, to: copy.folder });
  await projects.reload();
  await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, projects.list().find((p) => p.folder === copy.folder) ?? copy);
}

async function copyProject(deps: ItemCommandsDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session || entry?.kind !== "ready") { return; }
  await runSafely(session.logger, "labshelf.writing.copyProject", async () => {
    const { id } = entry.settings;
    if (!entry.main) { void vscode.window.showWarningMessage(`Set the main document of ${id} to copy it.`); return; }
    const title = (await vscode.window.showInputBox({ prompt: `Title of the copy of ${id}`, value: `${entry.settings.title ?? id} copy` }))?.trim();
    if (!title) { return; }
    await copyProjectEntry(deps, entry, title);
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
