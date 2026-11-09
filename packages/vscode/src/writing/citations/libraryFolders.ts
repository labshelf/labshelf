// Links library folders to a writing project: the Link and Unlink commands, and the sync that keeps linked projects' labshelf.bib current as the library changes.
import * as vscode from "vscode";

import { createDebouncer, listFolderCiteKeys, listLibraryFolderCounts, type PaperRecord } from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { onPaperChange, type LibraryEvents } from "../../library/index.js";
import { readActiveProject } from "../build/index.js";
import type { ActiveSource } from "../activeSource.js";
import type { ReadyProject, WritingHost, WritingProjects } from "../projects/index.js";
import type { BibliographySync } from "./bibliographySync.js";

const LINK_LIBRARY_FOLDER_COMMAND = "labshelf.writing.linkLibraryFolder";
const UNLINK_LIBRARY_FOLDER_COMMAND = "labshelf.writing.unlinkLibraryFolder";
const SYNC_DEBOUNCE_MS = 1000;

export interface LibraryFolderDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "reload">;
  activeSource: Pick<ActiveSource, "current">;
  listPapers: () => Promise<PaperRecord[]>;
  sync: Pick<BibliographySync, "updateProject">;
}

/** The project the command acts on: the one of the focused file, else a pick among the ready projects. */
async function chooseProject(deps: LibraryFolderDeps, target: ReadyProject | undefined): Promise<ReadyProject | undefined> {
  if (target?.kind === "ready") { return deps.projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.folder === target.folder); }
  const active = readActiveProject(deps.projects, deps.activeSource);
  if (active) { return active; }
  const ready = deps.projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready");
  if (ready.length === 0) {
    void vscode.window.showInformationMessage("Open or create a LabShelf project first.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(ready.map((project) => ({ label: project.settings.id, description: project.folder, project })), { placeHolder: "Pick the project" });
  return picked?.project;
}

/** The project as labshelf.yaml was last read, so a second link does not drop the first. */
function latest(deps: LibraryFolderDeps, project: ReadyProject): ReadyProject {
  return deps.projects.list().find((entry): entry is ReadyProject => entry.kind === "ready" && entry.folder === project.folder) ?? project;
}

export async function writeFolders(deps: LibraryFolderDeps, project: ReadyProject, folders: string[]): Promise<void> {
  await deps.projects.data.updateProjectSettings(project.folder, { libraryFolders: folders.length > 0 ? folders : undefined });
  await deps.projects.reload();
  const reloaded = latest(deps, project);
  await deps.sync.updateProject(reloaded);
}

/** Runs a command on the project it acts on, once a library is open and a project is chosen; failures are reported by `runSafely`. */
export async function runOnProject(
  deps: LibraryFolderDeps, target: ReadyProject | undefined, command: string, run: (project: ReadyProject) => Promise<void>,
): Promise<void> {
  const session = await deps.host.require();
  const chosen = session && await chooseProject(deps, target);
  if (!session || !chosen) { return; }
  const project = latest(deps, chosen);
  await runSafely(session.logger, command, () => run(project));
}

async function linkFolder(deps: LibraryFolderDeps, target: ReadyProject | undefined): Promise<void> {
  await runOnProject(deps, target, LINK_LIBRARY_FOLDER_COMMAND, async (project) => {
    const papers = await deps.listPapers();
    const linked = project.settings.libraryFolders ?? [];
    const choices = listLibraryFolderCounts(papers, linked)
      .map(({ folder, papers: count }) => ({ label: folder, description: `${count} ${count === 1 ? "paper" : "papers"}` }));
    if (choices.length === 0) {
      void vscode.window.showInformationMessage("Every library folder is already linked, or no library folder holds a paper.");
      return;
    }
    const picked = await vscode.window.showQuickPick(choices, {
      placeHolder: `Link a library folder to ${project.settings.id}. Its papers stay in this project's bibliography`, matchOnDescription: true,
    });
    if (!picked) { return; }
    await writeFolders(deps, project, [...linked, picked.label]);
    const count = listFolderCiteKeys(papers, [picked.label]).length;
    void vscode.window.showInformationMessage(`${count} ${count === 1 ? "paper" : "papers"} from ${picked.label} ${count === 1 ? "is" : "are"} in labshelf.bib.`);
  });
}

/** @param folder the folder to unlink, when the caller (the project menu's row) already chose it; else a pick */
async function unlinkFolder(deps: LibraryFolderDeps, target: ReadyProject | undefined, folder?: string): Promise<void> {
  await runOnProject(deps, target, UNLINK_LIBRARY_FOLDER_COMMAND, async (project) => {
    const linked = project.settings.libraryFolders ?? [];
    if (linked.length === 0) {
      void vscode.window.showInformationMessage(`${project.settings.id} has no linked library folder.`);
      return;
    }
    const chosen = typeof folder === "string" ? folder : (await vscode.window.showQuickPick(linked.map((name) => ({ label: name })), { placeHolder: `Unlink a library folder from ${project.settings.id}` }))?.label;
    if (chosen === undefined) { return; }
    await writeFolders(deps, project, linked.filter((name) => name !== chosen));
  });
}

/** Runs the bibliography update of every ready project with linked folders; the updates queue in the sync. */
export async function updateLinkedProjects(projects: Pick<WritingProjects, "list">, sync: Pick<BibliographySync, "updateProject">): Promise<void> {
  for (const entry of projects.list()) {
    if (entry.kind === "ready" && (entry.settings.libraryFolders?.length ?? 0) > 0) { await sync.updateProject(entry); }
  }
}

/** Updates the linked projects about a second after a paper is added, moved, re-keyed or deleted. */
export function watchLinkedProjects(
  events: LibraryEvents, projects: Pick<WritingProjects, "list">, sync: Pick<BibliographySync, "updateProject">,
  debounceMs: number = SYNC_DEBOUNCE_MS,
): vscode.Disposable {
  const soon = createDebouncer(() => void updateLinkedProjects(projects, sync), debounceMs);
  return vscode.Disposable.from(onPaperChange(events, () => soon.call()), { dispose: () => soon.cancel() });
}

export function registerLibraryFolderCommands(deps: LibraryFolderDeps, events: LibraryEvents): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(LINK_LIBRARY_FOLDER_COMMAND, (target?: ReadyProject) => linkFolder(deps, target)),
    vscode.commands.registerCommand(UNLINK_LIBRARY_FOLDER_COMMAND, (target?: ReadyProject, folder?: string) => unlinkFolder(deps, target, folder)),
    watchLinkedProjects(events, deps.projects, deps.sync),
  );
}
