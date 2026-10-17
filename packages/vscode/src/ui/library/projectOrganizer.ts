// Moves projects between My projects folders and archives them by rewriting each project's labshelf.yaml.
import * as vscode from "vscode";
import type { ProjectEntry, ProjectSettingsPatch } from "@labshelf/core";
import { validateFolderNameInput } from "./folderNameInput.js";
import type { ProjectEdit, ProjectFolderAction } from "./sidebarMessages.js";

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

/** What the organizer needs from the project list. */
export interface ProjectOrganizerPort {
  list(): readonly ProjectEntry[];
  update(folder: string, patch: ProjectSettingsPatch): Promise<void>;
}

const ready = (port: ProjectOrganizerPort): ReadyEntry[] =>
  port.list().filter((entry): entry is ReadyEntry => entry.kind === "ready");

const isUnder = (folder: string | undefined, path: string): boolean => folder === path || (folder?.startsWith(`${path}/`) ?? false);

async function applyAll(port: ProjectOrganizerPort, edits: Array<[ReadyEntry, ProjectSettingsPatch]>): Promise<void> {
  const failures: string[] = [];
  for (const [entry, patch] of edits) {
    try { await port.update(entry.folder, patch); } catch (error) { failures.push(`${entry.settings.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  await vscode.commands.executeCommand("labshelf.writing.refresh");
  if (failures.length > 0) { void vscode.window.showErrorMessage(`Could not update ${failures.length} project(s): ${failures.join("; ")}`); }
}

const folderName = (prompt: string, value = ""): Thenable<string | undefined> =>
  vscode.window.showInputBox({ prompt, value, validateInput: validateFolderNameInput });

/** Every folder some active project sits in, with its parents. */
function knownFolders(port: ProjectOrganizerPort): string[] {
  const all = new Set<string>();
  for (const entry of ready(port)) {
    const parts = entry.settings.archived ? [] : entry.settings.folder?.split("/") ?? [];
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join("/")));
  }
  return [...all].sort();
}

async function newFolder(port: ProjectOrganizerPort, parent: string): Promise<void> {
  const name = await folderName(parent ? `New folder in ${parent}` : "New folder");
  if (!name) { return; }
  const path = parent ? `${parent}/${name.trim()}` : name.trim();
  // A folder exists only while a project sits in it, so the new one is filled at once.
  const picks = await vscode.window.showQuickPick(
    ready(port).filter((entry) => !entry.settings.archived).map((entry) => ({ label: entry.settings.id, description: entry.settings.folder ?? "", entry })),
    { canPickMany: true, title: `Projects to move into ${path}` },
  );
  if (!picks || picks.length === 0) { return; }
  await applyAll(port, picks.map(({ entry }) => [entry, { folder: path }]));
}

async function renameFolder(port: ProjectOrganizerPort, path: string): Promise<void> {
  const slash = path.lastIndexOf("/");
  const name = await folderName(`Rename ${path}`, path.slice(slash + 1));
  if (!name || name.trim() === path.slice(slash + 1)) { return; }
  const renamed = `${path.slice(0, slash + 1)}${name.trim()}`;
  await applyAll(port, ready(port).filter((entry) => isUnder(entry.settings.folder, path))
    .map((entry) => [entry, { folder: renamed + entry.settings.folder!.slice(path.length) }]));
}

/** The folder's projects move up to its parent; no project is deleted. */
async function deleteFolder(port: ProjectOrganizerPort, path: string): Promise<void> {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
  await applyAll(port, ready(port).filter((entry) => isUnder(entry.settings.folder, path)).map((entry) => {
    const rest = entry.settings.folder!.slice(path.length + 1);
    const folder = [parent, rest].filter(Boolean).join("/");
    return [entry, { folder: folder || undefined }];
  }));
}

export async function runProjectFolderAction(port: ProjectOrganizerPort, action: ProjectFolderAction, path: string): Promise<void> {
  if (action === "new") { await newFolder(port, path); return; }
  if (path === "") { return; }
  await (action === "rename" ? renameFolder(port, path) : deleteFolder(port, path));
}

async function moveProject(port: ProjectOrganizerPort, entry: ReadyEntry): Promise<void> {
  const NEW = "New folder…";
  const items = [
    { label: "My projects", description: "top level", path: "" },
    ...knownFolders(port).map((path) => ({ label: path, description: "", path })),
    { label: NEW, description: "", path: "" },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: `Move ${entry.settings.id} to` });
  if (!pick) { return; }
  let path = pick.path;
  if (pick.label === NEW) {
    const name = await folderName("New folder");
    if (!name) { return; }
    path = name.trim();
  }
  await applyAll(port, [[entry, { folder: path || undefined, archived: undefined }]]);
}

export async function runProjectEdit(port: ProjectOrganizerPort, id: string, edit: ProjectEdit): Promise<void> {
  const entry = ready(port).find((candidate) => candidate.folder === id);
  if (!entry) { return; }
  if (edit === "move") { await moveProject(port, entry); return; }
  await applyAll(port, [[entry, { archived: edit === "archive" ? true : undefined }]]);
}
