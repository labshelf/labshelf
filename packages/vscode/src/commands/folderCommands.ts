/** Creates, renames, moves and trashes library folders through the core mutations, then brings the index and views along. */
import * as vscode from "vscode";

import { createFolder, moveFolder, renameFolder, trashFolder } from "@labshelf/core";
import { validateFolderNameInput, type LibraryNode } from "../ui/library/index.js";
import type { ActiveServices, RequireServices } from "./registerCommands/index.js";

const LOG_MODULE = "commands/folderCommands";

export interface FolderCommandHost {
  requireServices: RequireServices;
  /** papers/ of the configured library, or null while none is configured. */
  papersRoot: () => string | null;
  /** Re-reads the folder tree and the list panel. */
  refreshViews: () => void;
  /** Lets an open list panel follow a folder that moved under it. */
  followFolderMove: (from: string, to: string) => Promise<void>;
}

/** Registers the folder commands of the Library view. */
export function registerFolderCommands(context: vscode.ExtensionContext, host: FolderCommandHost): void {
  // Two command ids on purpose: VS Code hands title-bar actions the focused tree item, so a shared id would nest every
  // new folder inside whatever row happened to be selected. The title-bar id takes no node and targets papers/.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.newFolder", (node?: LibraryNode) => newFolder(host, node)),
    vscode.commands.registerCommand("labshelf.newFolderAtRoot", () => newFolder(host)),
    vscode.commands.registerCommand("labshelf.renameFolder", (node?: LibraryNode) => renameFolderNode(host, node)),
    vscode.commands.registerCommand("labshelf.deleteFolder", (node?: LibraryNode) => trashFolderNode(host, node)),
  );
}

/** Moves folders dragged in the tree into targetDir (papers/ when absent); a failed move is shown and logged. */
export async function moveFolders(host: FolderCommandHost, sourceDirs: string[], targetDir?: string): Promise<void> {
  const services = await host.requireServices();
  const target = targetDir ?? host.papersRoot();
  if (!services || !target) { return; }
  for (const sourceDir of sourceDirs) {
    await guarded(services, `Could not move "${services.mutations.paths.basename(sourceDir)}"`, { sourceDir, target }, async () => {
      const movedTo = await moveFolder(services.mutations, sourceDir, target);
      if (movedTo === sourceDir) { return; }
      await services.paperService.relocatePapersUnder(sourceDir, movedTo);
      await host.followFolderMove(sourceDir, movedTo);
    });
  }
  host.refreshViews();
}

/** The folder changes, without prompts, for a caller that asks the user itself (the list panel). Each one throws when it fails. */
export function folderActions(host: FolderCommandHost): {
  create(parent: string, name: string): Promise<void>;
  rename(dir: string, name: string): Promise<void>;
  trash(dir: string): Promise<void>;
} {
  return {
    create: (parent, name) => createFolderIn(host, parent, name),
    rename: (dir, name) => renameFolderTo(host, dir, name),
    trash: (dir) => trashFolderAt(host, dir),
  };
}

/** Creates folder `name` in `parent`, then refreshes the views. Throws when it cannot. */
async function createFolderIn(host: FolderCommandHost, parent: string, name: string): Promise<void> {
  const services = await host.requireServices();
  if (!services) { return; }
  await createFolder(services.mutations, parent, name);
  host.refreshViews();
}

/** Renames folder `dir` to `name`, brings its papers' records along and keeps an open list panel on it. Throws when it cannot. */
async function renameFolderTo(host: FolderCommandHost, dir: string, name: string): Promise<void> {
  const services = await host.requireServices();
  if (!services) { return; }
  const renamed = await renameFolder(services.mutations, dir, name);
  await services.paperService.relocatePapersUnder(dir, renamed);
  host.refreshViews();
  await host.followFolderMove(dir, renamed);
}

/** Moves folder `dir` with everything inside it to the trash. Throws when it cannot. */
async function trashFolderAt(host: FolderCommandHost, dir: string): Promise<void> {
  const services = await host.requireServices();
  if (!services) { return; }
  // The index follows the disk: its papers leave the list only once the folder is really in the trash.
  await trashFolder(services.mutations, dir);
  await services.paperService.removePapersUnder(dir);
  host.refreshViews();
}

async function newFolder(host: FolderCommandHost, node?: LibraryNode): Promise<void> {
  const services = await host.requireServices();
  const parent = node?.dirPath ?? host.papersRoot();
  if (!services || !parent) { return; }
  const name = await vscode.window.showInputBox({ prompt: "Folder name", placeHolder: "My Folder", validateInput: validateFolderNameInput });
  if (!name?.trim()) { return; }
  await guarded(services, "Could not create the folder", { parent, name }, () => createFolderIn(host, parent, name));
  host.refreshViews();
}

async function renameFolderNode(host: FolderCommandHost, node?: LibraryNode): Promise<void> {
  if (!node || node.isRoot) { return; }
  const services = await host.requireServices();
  if (!services) { return; }
  const name = await vscode.window.showInputBox({ prompt: "New folder name", value: node.label, validateInput: validateFolderNameInput });
  if (!name?.trim() || name.trim() === node.label) { return; }
  await guarded(services, `Could not rename "${node.label}"`, { dir: node.dirPath, name }, () => renameFolderTo(host, node.dirPath, name));
}

async function trashFolderNode(host: FolderCommandHost, node?: LibraryNode): Promise<void> {
  if (!node || node.isRoot) { return; }
  const services = await host.requireServices();
  if (!services) { return; }
  const choice = await vscode.window.showWarningMessage(
    `Delete folder "${node.label}" and everything inside it?`,
    { modal: true },
    "Delete",
  );
  if (choice !== "Delete") { return; }
  await guarded(services, `Could not delete "${node.label}"`, { dir: node.dirPath }, () => trashFolderAt(host, node.dirPath));
  host.refreshViews();
}

async function guarded(
  services: ActiveServices,
  failure: string,
  context: Record<string, unknown>,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await services.logger.log("WARN", LOG_MODULE, failure, { ...context, message });
    void vscode.window.showErrorMessage(`LabShelf: ${failure} — ${message}`);
  }
}
